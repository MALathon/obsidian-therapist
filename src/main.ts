import { Plugin, MarkdownView, Editor, debounce, Notice, TFile } from 'obsidian';
import { TherapistSettingTab, TherapistSettings, DEFAULT_SETTINGS } from './settings';
import { LettaService } from './LettaService';
import { getNewContent, isTherapistResponse, formatResponse, getJournalContent } from './contentParser';
import { MemoryViewerModal } from './MemoryViewerModal';

export default class TherapistPlugin extends Plugin {
  settings: TherapistSettings;
  lettaService: LettaService;
  private isProcessing: boolean = false;
  private statusBarEl: HTMLElement | null = null;
  private pendingInsights: string[] = [];
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

    // Add command to insert insight at cursor
    this.addCommand({
      id: 'insert-insight',
      name: 'Insert insight at cursor',
      editorCallback: (editor: Editor) => {
        if (this.pendingInsights.length > 0) {
          this.insertInsightAtCursor(editor);
        } else {
          new Notice('No insights available');
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
          this.pendingInsights = [];
          this.hideIndicator();
        } else {
          this.checkCurrentNote();
        }
        this.saveSettings();
        this.updateStatusBar();
        new Notice(`Therapist ${this.settings.enabled ? 'enabled' : 'disabled'}`);
      }
    });

    // Add command to view memory
    this.addCommand({
      id: 'view-memory',
      name: 'View therapist memory',
      callback: () => {
        this.openMemoryViewer();
      }
    });

    // Add command to reindex vault
    this.addCommand({
      id: 'reindex-vault',
      name: 'Reindex vault for therapist',
      callback: async () => {
        if (!this.settings.agentId) {
          new Notice('No therapist agent configured');
          return;
        }
        if (!this.settings.indexVault) {
          new Notice('Vault indexing is not enabled');
          return;
        }
        new Notice('Starting vault indexing...');
        try {
          await this.indexVault();
          new Notice('Vault indexed successfully');
        } catch (error) {
          console.error('Indexing failed:', error);
          new Notice(`Indexing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
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

    // Check if current file is in allowed folders
    const file = view.file;
    if (file && !this.shouldObserveFile(file)) {
      this.hideIndicator();
      this.updateStatusBar('off');
      return;
    }

    // Show orb - with insight state if we have queued insights
    if (this.pendingInsights.length > 0) {
      this.showIndicator('insight');
      this.updateStatusBar('insight');
    } else {
      this.showIndicator('observing');
      this.updateStatusBar('listening');
    }
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

    // Check if file is in allowed folders
    const file = view.file;
    if (file && !this.shouldObserveFile(file)) return;

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
        // Add to queue instead of replacing
        this.pendingInsights.push(response);
        this.showIndicator('insight');
        this.updateStatusBar('insight');
      } else {
        // Keep insight state if we have queued insights
        if (this.pendingInsights.length > 0) {
          this.showIndicator('insight');
          this.updateStatusBar('insight');
        } else {
          this.showIndicator('observing');
          this.updateStatusBar('listening');
        }
      }
    } catch (error) {
      console.error('Error observing:', error);
      if (this.pendingInsights.length > 0) {
        this.showIndicator('insight');
        this.updateStatusBar('insight');
      } else {
        this.showIndicator('observing');
        this.updateStatusBar('listening');
      }
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
    if (this.pendingInsights.length === 0 || !this.indicatorEl) return;

    if (!this.popoverEl) {
      this.popoverEl = document.createElement('div');
      this.popoverEl.className = 'therapist-popover';
      this.indicatorEl.appendChild(this.popoverEl);
    }

    // Build content with all insights
    const insightCount = this.pendingInsights.length;
    const insightsHtml = this.pendingInsights
      .map((insight, i) => `<div class="therapist-insight-item">${insight}</div>`)
      .join('<hr class="therapist-insight-divider">');

    this.popoverEl.innerHTML = `
      <div class="therapist-popover-header">
        <span class="therapist-popover-title">${insightCount} Insight${insightCount > 1 ? 's' : ''}</span>
        <button class="therapist-popover-dismiss">×</button>
      </div>
      <div class="therapist-popover-content">${insightsHtml}</div>
      <div class="therapist-popover-actions">
        <button class="therapist-popover-btn secondary dismiss-btn">Dismiss All</button>
        <button class="therapist-popover-btn primary insert-btn">Insert at Cursor</button>
      </div>
    `;

    // Event listeners
    this.popoverEl.querySelector('.therapist-popover-dismiss')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hidePopover();
    });

    this.popoverEl.querySelector('.dismiss-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dismissInsights();
    });

    this.popoverEl.querySelector('.insert-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view) {
        this.insertInsightAtCursor(view.editor);
      }
    });

    this.popoverEl.classList.add('is-visible');
    this.popoverVisible = true;
  }

  private hidePopover() {
    if (this.popoverEl) {
      this.popoverEl.classList.remove('is-visible');
    }
    this.popoverVisible = false;
  }

  private dismissInsights() {
    this.pendingInsights = [];
    this.hidePopover();
    this.showIndicator('observing');
    this.updateStatusBar('listening');
  }

  private insertInsightAtCursor(editor: Editor) {
    if (this.pendingInsights.length === 0) return;

    // Format all insights as blockquotes
    const formattedInsights = this.pendingInsights
      .map(insight => formatResponse(insight, this.settings.therapistName))
      .join('\n');

    // Insert at cursor position
    editor.replaceSelection(formattedInsights);

    new Notice(`Inserted ${this.pendingInsights.length} insight${this.pendingInsights.length > 1 ? 's' : ''}`);
    this.dismissInsights();
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

  /**
   * Open the memory viewer modal
   */
  openMemoryViewer() {
    if (!this.settings.agentId) {
      new Notice('No therapist agent configured');
      return;
    }
    new MemoryViewerModal(this.app, this.lettaService, this.settings.agentId).open();
  }

  /**
   * Index the vault content into Letta archives for RAG
   */
  async indexVault(): Promise<void> {
    if (!this.settings.agentId) {
      throw new Error('No agent configured');
    }

    // Create or get archive
    let archiveId = this.settings.archiveId;
    if (!archiveId) {
      // Check if archive already exists
      const archives = await this.lettaService.listArchives();
      const existing = archives.find(a => a.name === 'obsidian-vault');
      if (existing) {
        archiveId = existing.id;
      } else {
        archiveId = await this.lettaService.createArchive('obsidian-vault');
        // Attach to agent
        await this.lettaService.attachArchive(this.settings.agentId, archiveId);
      }
      this.settings.archiveId = archiveId;
      await this.saveSettings();
    }

    // Clear existing passages for fresh index
    await this.lettaService.clearArchive(archiveId);

    // Get all markdown files
    const files = this.app.vault.getMarkdownFiles();
    let indexed = 0;

    for (const file of files) {
      // Check if file should be indexed based on folder settings
      if (!this.shouldIndexFile(file)) {
        continue;
      }

      try {
        const content = await this.app.vault.read(file);
        if (content.trim().length < 50) {
          // Skip very short files
          continue;
        }

        // Split content into chunks (simple approach - by paragraphs)
        const chunks = this.chunkContent(content, file.path);
        for (const chunk of chunks) {
          await this.lettaService.addPassage(archiveId, chunk.text, {
            source: file.path,
            title: file.basename,
          });
        }
        indexed++;
      } catch (error) {
        console.warn(`Failed to index ${file.path}:`, error);
      }
    }

    this.settings.lastIndexed = Date.now();
    await this.saveSettings();

    console.log(`Indexed ${indexed} files`);
  }

  /**
   * Check if a file should be observed (same logic as indexing)
   */
  private shouldObserveFile(file: TFile): boolean {
    // If no folders configured, observe everything
    if (this.settings.includedFolders.length === 0 && this.settings.excludedFolders.length === 0) {
      return true;
    }
    return this.shouldIndexFile(file);
  }

  /**
   * Check if a file should be indexed based on folder settings
   */
  private shouldIndexFile(file: TFile): boolean {
    const filePath = file.path;

    // Check excluded folders first
    for (const excluded of this.settings.excludedFolders) {
      if (excluded === '' || excluded === '/') {
        continue; // Don't exclude root
      }
      if (filePath.startsWith(excluded + '/') || filePath === excluded) {
        return false;
      }
    }

    // If included folders are specified, file must be in one of them
    if (this.settings.includedFolders.length > 0) {
      const hasRoot = this.settings.includedFolders.includes('') || this.settings.includedFolders.includes('/');
      if (hasRoot) {
        return true; // Root includes everything
      }
      for (const included of this.settings.includedFolders) {
        if (filePath.startsWith(included + '/') || filePath === included) {
          return true;
        }
      }
      return false;
    }

    return true;
  }

  /**
   * Split content into chunks for indexing
   */
  private chunkContent(content: string, path: string): Array<{ text: string }> {
    const chunks: Array<{ text: string }> = [];
    const maxChunkSize = 1500; // Characters per chunk

    // Split by paragraphs (double newline)
    const paragraphs = content.split(/\n\n+/);
    let currentChunk = `[${path}]\n\n`;

    for (const paragraph of paragraphs) {
      const trimmed = paragraph.trim();
      if (!trimmed) continue;

      // Skip very short paragraphs that are likely headings alone
      if (trimmed.length < 20 && trimmed.startsWith('#')) {
        currentChunk += trimmed + '\n\n';
        continue;
      }

      if (currentChunk.length + trimmed.length > maxChunkSize && currentChunk.length > 100) {
        // Save current chunk and start new one
        chunks.push({ text: currentChunk.trim() });
        currentChunk = `[${path}]\n\n`;
      }

      currentChunk += trimmed + '\n\n';
    }

    // Don't forget the last chunk
    if (currentChunk.trim().length > 50) {
      chunks.push({ text: currentChunk.trim() });
    }

    return chunks;
  }
}
