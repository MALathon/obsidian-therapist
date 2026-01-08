import { Plugin, MarkdownView, Editor, debounce, Notice, TFile } from 'obsidian';
import { moment } from 'obsidian';
import { TherapistSettingTab, TherapistSettings, DEFAULT_SETTINGS } from './settings';
import { LettaService } from './LettaService';
import { getNewContent, isTherapistResponse, formatResponse, getJournalContent } from './contentParser';

export default class TherapistPlugin extends Plugin {
  settings: TherapistSettings;
  lettaService: LettaService;
  private isProcessing: boolean = false;
  private statusBarEl: HTMLElement | null = null;
  private pendingInsight: string | null = null;
  private indicatorEl: HTMLElement | null = null;
  private popoverEl: HTMLElement | null = null;
  private popoverVisible: boolean = false;

  async onload() {
    await this.loadSettings();

    this.lettaService = new LettaService(this.settings.lettaUrl, this.settings.apiKey);

    // Add settings tab
    this.addSettingTab(new TherapistSettingTab(this.app, this));

    // Create debounced handler for passive observation
    const debouncedObserver = debounce(
      (editor: Editor, view: MarkdownView) => this.observeContent(editor, view),
      this.settings.debounceMs,
      true
    );

    // Register editor change event for passive observation
    this.registerEvent(
      this.app.workspace.on('editor-change', (editor: Editor, view: MarkdownView) => {
        if (!this.settings.enabled) return;
        if (!this.settings.agentId) return;
        debouncedObserver(editor, view);
      })
    );

    // Add command to manually trigger inline conversation
    this.addCommand({
      id: 'trigger-therapist',
      name: 'Talk to therapist (inline response)',
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        await this.triggerConversation(editor, view);
      }
    });

    // Add command to copy insight to daily note
    this.addCommand({
      id: 'copy-insight',
      name: 'Copy insight to daily note',
      callback: () => {
        if (this.pendingInsight) {
          this.copyToDailyNote();
        } else {
          new Notice('No insight available');
        }
      }
    });

    // Add command to toggle therapist
    this.addCommand({
      id: 'toggle-therapist',
      name: 'Toggle therapist on/off',
      callback: () => {
        this.settings.enabled = !this.settings.enabled;
        if (!this.settings.enabled) {
          this.pendingInsight = null;
          this.hideIndicator();
        } else {
          this.checkCurrentNote();
        }
        this.saveSettings();
        this.updateStatusBar();
        new Notice(`Therapist ${this.settings.enabled ? 'enabled' : 'disabled'}`);
      }
    });

    // Add status bar indicator
    this.statusBarEl = this.addStatusBarItem();
    this.updateStatusBar();

    // Update on note switch
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this.checkCurrentNote();
      })
    );

    this.registerEvent(
      this.app.workspace.on('file-open', () => {
        this.checkCurrentNote();
      })
    );

    // Click outside to dismiss popover
    this.registerDomEvent(document, 'click', (e: MouseEvent) => {
      if (this.popoverVisible && this.indicatorEl) {
        if (!this.indicatorEl.contains(e.target as Node)) {
          this.hidePopover();
        }
      }
    });

    this.checkCurrentNote();
    console.log('Therapist plugin loaded');
  }

  private checkCurrentNote() {
    this.pendingInsight = null;
    this.hidePopover();

    if (!this.settings.enabled || !this.settings.agentId) {
      this.hideIndicator();
      this.updateStatusBar();
      return;
    }

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      this.hideIndicator();
      this.updateStatusBar('off');
      return;
    }

    // Show orb in observing state
    this.showIndicator('observing');
    this.updateStatusBar('listening');
  }

  updateStatusBar(state?: 'listening' | 'thinking' | 'insight' | 'off') {
    if (!this.statusBarEl) return;

    if (!this.settings.enabled) {
      this.statusBarEl.setText('○ Therapist off');
      return;
    }

    if (!this.settings.agentId) {
      this.statusBarEl.setText('○ No agent');
      return;
    }

    switch (state) {
      case 'thinking':
        this.statusBarEl.setText('◉ Observing...');
        break;
      case 'insight':
        this.statusBarEl.setText('💭 Has insight');
        break;
      case 'off':
        this.statusBarEl.setText('○ Therapist off');
        break;
      default:
        this.statusBarEl.setText('● Observing');
    }
  }

  // Passive observation - agent watches and may offer insights
  private async observeContent(editor: Editor, view: MarkdownView) {
    if (this.isProcessing) return;
    if (!this.settings.agentId) return;

    const fullContent = editor.getValue();
    const newContent = getNewContent(fullContent);
    if (!newContent) return;
    if (isTherapistResponse(newContent)) return;

    this.isProcessing = true;
    this.showIndicator('thinking');
    this.updateStatusBar('thinking');

    try {
      const observerPrompt = `[OBSERVER MODE - You are passively watching the user write. Only respond if you notice something genuinely insightful - a pattern, a reframe, a question worth asking, or an observation that could help. If nothing stands out, respond with just: [listening]]\n\n${newContent}`;

      const response = await this.lettaService.sendMessage(
        this.settings.agentId,
        observerPrompt
      );

      const trimmed = response?.trim() || '';
      if (trimmed && trimmed !== '[listening]') {
        this.pendingInsight = response;
        this.showIndicator('insight');
        this.updateStatusBar('insight');
      } else {
        this.showIndicator('observing');
        this.updateStatusBar('listening');
      }
    } catch (error) {
      console.error('Error observing:', error);
      this.showIndicator('observing');
      this.updateStatusBar('listening');
    } finally {
      this.isProcessing = false;
    }
  }

  // Manual trigger for inline conversation
  private async triggerConversation(editor: Editor, view: MarkdownView) {
    if (this.isProcessing) return;
    if (!this.settings.agentId) {
      new Notice('No therapist agent configured');
      return;
    }

    const fullContent = editor.getValue();
    const newContent = getNewContent(fullContent);
    if (!newContent) {
      new Notice('Nothing new to discuss');
      return;
    }

    this.isProcessing = true;
    this.showIndicator('thinking');
    this.updateStatusBar('thinking');

    try {
      const conversationPrompt = `[CONVERSATION MODE - The user wants to talk. Respond directly and helpfully.]\n\n${newContent}`;

      const response = await this.lettaService.sendMessage(
        this.settings.agentId,
        conversationPrompt
      );

      const trimmed = response?.trim() || '';
      if (trimmed && trimmed !== '[listening]') {
        // Insert inline for conversation mode
        const cursor = editor.getCursor();
        const line = cursor.line;
        editor.setCursor({ line, ch: editor.getLine(line).length });
        editor.replaceSelection(formatResponse(response, this.settings.therapistName));
      }

      this.showIndicator('observing');
      this.updateStatusBar('listening');
    } catch (error) {
      console.error('Error in conversation:', error);
      new Notice('Failed to get response');
      this.showIndicator('observing');
      this.updateStatusBar('listening');
    } finally {
      this.isProcessing = false;
    }
  }

  private showIndicator(state: 'observing' | 'thinking' | 'insight') {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      this.hideIndicator();
      return;
    }

    const editorEl = view.contentEl;

    if (!this.indicatorEl) {
      this.indicatorEl = document.createElement('div');
      this.indicatorEl.className = 'therapist-indicator is-visible';

      const orb = document.createElement('div');
      orb.className = 'therapist-orb';
      orb.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.pendingInsight) {
          this.togglePopover();
        }
      });

      this.indicatorEl.appendChild(orb);
    }

    // Update orb state
    const orb = this.indicatorEl.querySelector('.therapist-orb');
    if (orb) {
      orb.classList.remove('is-thinking', 'has-insight');
      if (state === 'thinking') {
        orb.classList.add('is-thinking');
      } else if (state === 'insight') {
        orb.classList.add('has-insight');
      }
    }

    if (!editorEl.contains(this.indicatorEl)) {
      editorEl.appendChild(this.indicatorEl);
    }
  }

  private hideIndicator() {
    if (this.indicatorEl) {
      this.indicatorEl.remove();
      this.indicatorEl = null;
    }
    this.hidePopover();
  }

  private togglePopover() {
    if (this.popoverVisible) {
      this.hidePopover();
    } else {
      this.showPopover();
    }
  }

  private showPopover() {
    if (!this.pendingInsight || !this.indicatorEl) return;

    if (!this.popoverEl) {
      this.popoverEl = document.createElement('div');
      this.popoverEl.className = 'therapist-popover';

      this.popoverEl.innerHTML = `
        <div class="therapist-popover-header">
          <span class="therapist-popover-title">Therapist Insight</span>
          <button class="therapist-popover-dismiss">×</button>
        </div>
        <div class="therapist-popover-content"></div>
        <div class="therapist-popover-actions">
          <button class="therapist-popover-btn secondary dismiss-btn">Dismiss</button>
          <button class="therapist-popover-btn primary copy-btn">Copy to Daily Note</button>
        </div>
      `;

      // Event listeners
      this.popoverEl.querySelector('.therapist-popover-dismiss')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hidePopover();
      });

      this.popoverEl.querySelector('.dismiss-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dismissInsight();
      });

      this.popoverEl.querySelector('.copy-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.copyToDailyNote();
      });

      this.indicatorEl.appendChild(this.popoverEl);
    }

    // Update content
    const contentEl = this.popoverEl.querySelector('.therapist-popover-content');
    if (contentEl) {
      contentEl.textContent = this.pendingInsight;
    }

    this.popoverEl.classList.add('is-visible');
    this.popoverVisible = true;
  }

  private hidePopover() {
    if (this.popoverEl) {
      this.popoverEl.classList.remove('is-visible');
    }
    this.popoverVisible = false;
  }

  private dismissInsight() {
    this.pendingInsight = null;
    this.hidePopover();
    this.showIndicator('observing');
    this.updateStatusBar('listening');
  }

  private async copyToDailyNote() {
    if (!this.pendingInsight) return;

    try {
      // Get today's daily note path
      const today = moment().format('YYYY-MM-DD');
      const dailyNotePath = `${today}.md`;

      let file = this.app.vault.getAbstractFileByPath(dailyNotePath);

      if (!file) {
        // Create daily note if it doesn't exist
        file = await this.app.vault.create(dailyNotePath, `# ${today}\n\n## Journal\n\n### Therapist Insight\n\n${this.pendingInsight}\n`);
        new Notice('Created daily note with insight');
      } else if (file instanceof TFile) {
        // Append to existing daily note
        let content = await this.app.vault.read(file);

        // Check if ## Journal section exists
        if (!content.includes('## Journal')) {
          content += '\n\n## Journal\n';
        }

        // Find ## Journal section and add insight after it
        const journalIndex = content.indexOf('## Journal');
        const afterJournal = content.substring(journalIndex);
        const nextSectionMatch = afterJournal.substring(11).match(/\n## /);

        const insightBlock = `\n### Therapist Insight\n\n${this.pendingInsight}\n`;

        if (nextSectionMatch) {
          // Insert before next section
          const insertPos = journalIndex + 11 + nextSectionMatch.index!;
          content = content.substring(0, insertPos) + insightBlock + content.substring(insertPos);
        } else {
          // Append at end
          content += insightBlock;
        }

        await this.app.vault.modify(file, content);
        new Notice('Insight copied to daily note');
      }

      this.dismissInsight();
    } catch (error) {
      console.error('Error copying to daily note:', error);
      new Notice('Failed to copy to daily note');
    }
  }

  onunload() {
    this.hideIndicator();
    console.log('Therapist plugin unloaded');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
