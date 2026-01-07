import { Plugin, MarkdownView, Editor, debounce } from 'obsidian';
import { TherapistSettingTab, TherapistSettings, DEFAULT_SETTINGS } from './settings';
import { LettaService } from './LettaService';
import { getNewContent, isTherapistResponse, formatResponse } from './contentParser';

export default class TherapistPlugin extends Plugin {
  settings: TherapistSettings;
  lettaService: LettaService;
  private isProcessing: boolean = false;

  async onload() {
    await this.loadSettings();

    this.lettaService = new LettaService(this.settings.lettaUrl);

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
        debouncedHandler(editor, view);
      })
    );

    // Add command to manually trigger therapist response
    this.addCommand({
      id: 'trigger-therapist',
      name: 'Ask therapist to respond',
      editorCallback: (editor: Editor, view: MarkdownView) => {
        this.handleEditorChange(editor, view);
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
        console.log(`Therapist ${status}`);
      }
    });

    // Initialize agent on first run if needed
    if (!this.settings.agentId) {
      await this.initializeAgent();
    }

    console.log('Therapist plugin loaded');
  }

  async handleEditorChange(editor: Editor, view: MarkdownView) {
    if (this.isProcessing) return;
    if (!this.settings.agentId) {
      console.error('No agent configured');
      return;
    }

    const content = editor.getValue();

    // Get new content since last therapist response
    const newContent = getNewContent(content);
    if (!newContent) return;

    // Don't respond to therapist responses
    if (isTherapistResponse(newContent)) return;

    this.isProcessing = true;

    try {
      const response = await this.lettaService.sendMessage(
        this.settings.agentId,
        newContent
      );

      if (response) {
        // Insert response at cursor position
        const cursor = editor.getCursor();
        const line = cursor.line;

        // Move to end of current line and insert response
        editor.setCursor({ line, ch: editor.getLine(line).length });
        editor.replaceSelection(formatResponse(response));
      }
    } catch (error) {
      console.error('Error getting therapist response:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  async initializeAgent() {
    try {
      console.log('Creating therapist agent...');
      const agentId = await this.lettaService.createAgent();
      this.settings.agentId = agentId;
      await this.saveSettings();
      console.log('Therapist agent created:', agentId);
    } catch (error) {
      console.error('Failed to create agent:', error);
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
