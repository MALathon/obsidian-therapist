import { Plugin, MarkdownView, Editor, debounce, Notice } from 'obsidian';
import { TherapistSettingTab, TherapistSettings, DEFAULT_SETTINGS } from './settings';
import { LettaService } from './LettaService';
import { getNewContent, isTherapistResponse, formatResponse, getJournalContent, hasEngagementCue } from './contentParser';

export default class TherapistPlugin extends Plugin {
  settings: TherapistSettings;
  lettaService: LettaService;
  private isProcessing: boolean = false;

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

    // Add command to start/toggle session
    this.addCommand({
      id: 'toggle-therapist',
      name: 'Toggle therapist on/off',
      callback: () => {
        this.settings.enabled = !this.settings.enabled;
        this.saveSettings();
        const status = this.settings.enabled ? 'enabled' : 'disabled';
        new Notice(`Therapist ${status}`);
      }
    });

    console.log('Therapist plugin loaded');
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
      return; // No journal section, skip
    }

    // Get new content since last therapist response (within journal section)
    const newContent = getNewContent(journalContent);
    if (!newContent) return;

    // Don't respond to therapist responses
    if (isTherapistResponse(newContent)) return;

    // Check for engagement cues - if none and not forced, let agent decide
    const hasEngagement = hasEngagementCue(newContent);

    this.isProcessing = true;

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
    }
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
