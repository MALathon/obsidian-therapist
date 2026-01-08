import { Plugin, MarkdownView, Editor, debounce, Notice, TFile, EventRef } from 'obsidian';
import { TherapistSettingTab, TherapistSettings, DEFAULT_SETTINGS } from './settings';
import { LettaService } from './LettaService';
import { VaultIndexer, IndexFilter } from './VaultIndexer';
import { getNewContent, isTherapistResponse, formatResponse, getJournalContent, hasEngagementCue } from './contentParser';

export default class TherapistPlugin extends Plugin {
  settings: TherapistSettings;
  lettaService: LettaService;
  vaultIndexer: VaultIndexer;
  private isProcessing: boolean = false;
  isIndexing: boolean = false;
  private statusBarEl: HTMLElement | null = null;
  private autoIndexEvents: EventRef[] = [];
  private indexQueue: Set<string> = new Set();
  private indexDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  async onload() {
    await this.loadSettings();

    this.lettaService = new LettaService(this.settings.lettaUrl, this.settings.apiKey);
    this.vaultIndexer = new VaultIndexer(this.app, this.lettaService);

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

    // Add command to start/toggle session
    this.addCommand({
      id: 'toggle-therapist',
      name: 'Toggle therapist on/off',
      callback: () => {
        this.settings.enabled = !this.settings.enabled;
        this.saveSettings();
        this.updateStatusBar();
        const status = this.settings.enabled ? 'enabled' : 'disabled';
        new Notice(`Therapist ${status}`);
      }
    });

    // Add command to reindex vault
    this.addCommand({
      id: 'index-vault',
      name: 'Reindex vault for therapist context',
      callback: async () => {
        if (!this.settings.agentId) {
          new Notice('Create an agent first in settings');
          return;
        }
        if (this.isIndexing) {
          new Notice('Indexing already in progress');
          return;
        }
        this.isIndexing = true;
        try {
          const filter = this.getIndexFilter();
          const result = await this.vaultIndexer.indexVault(this.settings.agentId, filter);
          new Notice(`Indexed ${result.files} files (${result.passages} passages)`);
        } catch (error) {
          console.error('Indexing failed:', error);
          new Notice(`Indexing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
          this.isIndexing = false;
        }
      }
    });

    // Add status bar indicator
    this.statusBarEl = this.addStatusBarItem();
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

    // Start auto-indexing if enabled
    if (this.settings.autoIndex && this.settings.agentId) {
      this.startAutoIndexing();
    }

    console.log('Therapist plugin loaded');
  }

  /**
   * Get the current index filter from settings
   */
  getIndexFilter(): IndexFilter {
    return {
      mode: this.settings.indexMode,
      folders: this.settings.indexFolders.split(',').map(f => f.trim()).filter(f => f)
    };
  }

  /**
   * Start watching for file changes to auto-index
   */
  startAutoIndexing() {
    this.stopAutoIndexing(); // Clear any existing watchers

    if (!this.settings.agentId) return;

    // Watch for file modifications
    const modifyRef = this.app.vault.on('modify', (file) => {
      if (file instanceof TFile && file.extension === 'md') {
        this.queueFileForIndexing(file);
      }
    });
    this.autoIndexEvents.push(modifyRef);
    this.registerEvent(modifyRef);

    // Watch for new files
    const createRef = this.app.vault.on('create', (file) => {
      if (file instanceof TFile && file.extension === 'md') {
        this.queueFileForIndexing(file);
      }
    });
    this.autoIndexEvents.push(createRef);
    this.registerEvent(createRef);

    console.log('Auto-indexing started');
  }

  /**
   * Stop watching for file changes
   */
  stopAutoIndexing() {
    // Events are auto-cleaned by Obsidian on unload, but we track for manual stop
    this.autoIndexEvents = [];
    if (this.indexDebounceTimer) {
      clearTimeout(this.indexDebounceTimer);
      this.indexDebounceTimer = null;
    }
    this.indexQueue.clear();
    console.log('Auto-indexing stopped');
  }

  /**
   * Queue a file for indexing (debounced to batch changes)
   */
  private queueFileForIndexing(file: TFile) {
    this.indexQueue.add(file.path);

    // Debounce: wait 5 seconds after last change before indexing
    if (this.indexDebounceTimer) {
      clearTimeout(this.indexDebounceTimer);
    }

    this.indexDebounceTimer = setTimeout(() => {
      this.processIndexQueue();
    }, 5000);
  }

  /**
   * Process all queued files for indexing
   */
  private async processIndexQueue() {
    if (this.indexQueue.size === 0) return;
    if (!this.settings.agentId) return;

    const paths = [...this.indexQueue];
    this.indexQueue.clear();

    const filter = this.getIndexFilter();

    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        await this.vaultIndexer.indexSingleFile(file, this.settings.agentId, filter);
      }
    }
  }

  private checkCurrentNote() {
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

  private updateStatusBar(state?: 'listening' | 'thinking' | 'off' | 'no-journal') {
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

      // Only insert if agent actually responded with content (not just listening)
      const trimmedResponse = response?.trim() || '';
      if (trimmedResponse && trimmedResponse !== '[listening]') {
        const cursor = editor.getCursor();
        const line = cursor.line;
        editor.setCursor({ line, ch: editor.getLine(line).length });
        editor.replaceSelection(formatResponse(response));
      }
    } catch (error) {
      console.error('Error getting therapist response:', error);
    } finally {
      this.isProcessing = false;
      this.updateStatusBar('listening');
    }
  }

  onunload() {
    this.stopAutoIndexing();
    console.log('Therapist plugin unloaded');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
