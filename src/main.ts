import { Plugin, MarkdownView, Editor, debounce, Notice } from 'obsidian';
import { TherapistSettingTab, TherapistSettings, DEFAULT_SETTINGS } from './settings';
import { LettaService } from './LettaService';
import { getNewContent, isTherapistResponse, formatResponse, getJournalContent, hasEngagementCue } from './contentParser';

export default class TherapistPlugin extends Plugin {
  settings: TherapistSettings;
  lettaService: LettaService;
  private isProcessing: boolean = false;
  private statusBarEl: HTMLElement | null = null;
  private pendingResponse: string | null = null;

  async onload() {
    await this.loadSettings();

    this.lettaService = new LettaService(this.settings.lettaUrl, this.settings.apiKey);

    // Add settings tab
    this.addSettingTab(new TherapistSettingTab(this.app, this));

    // Create debounced handler for editor changes
    const debouncedHandler = debounce(
      (editor: Editor, view: MarkdownView) => this.handleEditorChange(editor, view),
      this.settings.debounceMs,
      true
    );

    // Register editor change event
    this.registerEvent(
      this.app.workspace.on('editor-change', (editor: Editor, view: MarkdownView) => {
        if (!this.settings.enabled) return;
        if (!this.settings.agentId) return;  // No agent configured
        debouncedHandler(editor, view);
      })
    );

    // Add command to manually trigger therapist response
    this.addCommand({
      id: 'trigger-therapist',
      name: 'Ask therapist to respond',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        this.handleEditorChange(editor, view, true); // Force respond
      }
    });

    // Add command to insert pending response
    this.addCommand({
      id: 'insert-response',
      name: 'Insert therapist thought',
      editorCallback: (editor: Editor) => {
        if (this.pendingResponse) {
          this.insertPendingResponse();
        } else {
          new Notice('No thought ready');
        }
      }
    });

    // Add command to start/toggle session
    this.addCommand({
      id: 'toggle-therapist',
      name: 'Toggle therapist on/off',
      callback: () => {
        this.settings.enabled = !this.settings.enabled;
        if (!this.settings.enabled) {
          this.pendingResponse = null; // Clear pending when disabled
        }
        this.saveSettings();
        this.updateStatusBar();
        const status = this.settings.enabled ? 'enabled' : 'disabled';
        new Notice(`Therapist ${status}`);
      }
    });

    // Add status bar indicator with click handler
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass('mod-clickable');
    this.statusBarEl.onClickEvent(() => {
      if (this.pendingResponse) {
        this.insertPendingResponse();
      }
    });
    this.updateStatusBar();

    // Update status when switching notes
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this.checkCurrentNote();
      })
    );

    // Also check on file open
    this.registerEvent(
      this.app.workspace.on('file-open', () => {
        this.checkCurrentNote();
      })
    );

    // Initial check
    this.checkCurrentNote();

    console.log('Therapist plugin loaded');
  }

  private checkCurrentNote() {
    // Clear pending response when switching notes
    this.pendingResponse = null;

    if (!this.settings.enabled || !this.settings.agentId) {
      this.updateStatusBar();
      return;
    }

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      this.updateStatusBar('no-journal');
      return;
    }

    const content = view.editor.getValue();
    const hasJournal = getJournalContent(content) !== null;
    this.updateStatusBar(hasJournal ? 'listening' : 'no-journal');
  }

  updateStatusBar(state?: 'listening' | 'thinking' | 'ready' | 'off' | 'no-journal') {
    if (!this.statusBarEl) return;

    if (!this.settings.enabled) {
      this.statusBarEl.setText('○ Therapist off');
      this.statusBarEl.setAttribute('aria-label', 'Therapist is disabled');
      return;
    }

    if (!this.settings.agentId) {
      this.statusBarEl.setText('○ No agent');
      this.statusBarEl.setAttribute('aria-label', 'No therapist agent configured');
      return;
    }

    switch (state) {
      case 'thinking':
        this.statusBarEl.setText('◉ Thinking...');
        this.statusBarEl.setAttribute('aria-label', 'Therapist is processing');
        break;
      case 'ready':
        this.statusBarEl.setText('💭 Ready');
        this.statusBarEl.setAttribute('aria-label', 'Click to insert response');
        break;
      case 'no-journal':
        this.statusBarEl.setText('◦ No journal section');
        this.statusBarEl.setAttribute('aria-label', 'Add a ## Journal header to enable');
        break;
      case 'off':
        this.statusBarEl.setText('○ Therapist off');
        this.statusBarEl.setAttribute('aria-label', 'Therapist is disabled');
        break;
      default:
        this.statusBarEl.setText('● Listening');
        this.statusBarEl.setAttribute('aria-label', 'Therapist is monitoring');
    }
  }

  async handleEditorChange(editor: Editor, view: MarkdownView, forceRespond: boolean = false) {
    if (this.isProcessing) return;
    if (!this.settings.agentId) {
      console.error('No agent configured - create one in settings');
      return;
    }

    const fullContent = editor.getValue();

    // Only process notes with a Journal section
    const journalContent = getJournalContent(fullContent);
    if (!journalContent) {
      this.updateStatusBar('no-journal');
      return; // No journal section, skip
    }

    this.updateStatusBar('listening');

    // Get new content since last therapist response (within journal section)
    const newContent = getNewContent(journalContent);
    if (!newContent) return;

    // Don't respond to therapist responses
    if (isTherapistResponse(newContent)) return;

    // Check for engagement cues - if none and not forced, let agent decide
    const hasEngagement = hasEngagementCue(newContent);

    this.isProcessing = true;
    this.updateStatusBar('thinking');

    try {
      // Tell agent whether user is explicitly engaging
      const contextPrefix = hasEngagement || forceRespond
        ? '[User is asking for your input]\n\n'
        : '[User is journaling - respond only if you have something valuable to add]\n\n';

      const response = await this.lettaService.sendMessage(
        this.settings.agentId,
        contextPrefix + newContent
      );

      // Buffer response instead of auto-inserting
      const trimmedResponse = response?.trim() || '';
      if (trimmedResponse && trimmedResponse !== '[listening]') {
        this.pendingResponse = response;
        this.updateStatusBar('ready');
        new Notice('💭 Thought ready - click status bar or use hotkey to insert');
      } else {
        this.updateStatusBar('listening');
      }
    } catch (error) {
      console.error('Error getting therapist response:', error);
      this.updateStatusBar('listening');
    } finally {
      this.isProcessing = false;
    }
  }

  private insertPendingResponse() {
    if (!this.pendingResponse) return;

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice('No active editor');
      return;
    }

    const editor = view.editor;
    const cursor = editor.getCursor();
    const line = cursor.line;

    // Move to end of current line and insert
    editor.setCursor({ line, ch: editor.getLine(line).length });
    editor.replaceSelection(formatResponse(this.pendingResponse, this.settings.therapistName));

    // Clear the pending response
    this.pendingResponse = null;
    this.updateStatusBar('listening');
  }

  onunload() {
    console.log('Therapist plugin unloaded');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
