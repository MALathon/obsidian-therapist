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

    console.log('Therapist plugin loaded');
  }

  async handleEditorChange(editor: Editor, view: MarkdownView) {
    if (this.isProcessing) return;

    const enabledAgents = this.getEnabledAgents();
    if (enabledAgents.length === 0) {
      console.error('No agents configured - create one in settings');
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
      const responses = await this.getAgentResponses(enabledAgents, newContent);

      if (responses.length > 0) {
        const cursor = editor.getCursor();
        const line = cursor.line;
        editor.setCursor({ line, ch: editor.getLine(line).length });

        // Combine all responses
        const combinedResponse = responses
          .filter(r => r.content.trim())
          .map(r => r.content)
          .join('\n\n');

        if (combinedResponse) {
          editor.replaceSelection(formatResponse(combinedResponse));
        }
      }
    } catch (error) {
      console.error('Error getting therapist response:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private getEnabledAgents() {
    const { agents, multiAgentMode, primaryAgentId } = this.settings;

    if (multiAgentMode === 'single') {
      const primary = agents.find(a => a.id === primaryAgentId);
      return primary ? [primary] : agents.slice(0, 1);
    }

    // For sequential/parallel, return enabled agents sorted by order
    return agents
      .filter(a => a.enabled)
      .sort((a, b) => a.order - b.order);
  }

  private async getAgentResponses(
    agents: typeof this.settings.agents,
    content: string
  ): Promise<Array<{ agentId: string; name: string; content: string }>> {
    const { multiAgentMode } = this.settings;

    if (multiAgentMode === 'parallel') {
      // Query all agents simultaneously
      const promises = agents.map(async (agent) => {
        try {
          const response = await this.lettaService.sendMessage(agent.id, content);
          return { agentId: agent.id, name: agent.name, content: response };
        } catch (error) {
          console.error(`Agent ${agent.name} failed:`, error);
          return { agentId: agent.id, name: agent.name, content: '' };
        }
      });
      return Promise.all(promises);
    }

    // Sequential: each agent sees the content + previous responses
    const responses: Array<{ agentId: string; name: string; content: string }> = [];
    let accumulatedContext = content;

    for (const agent of agents) {
      try {
        const response = await this.lettaService.sendMessage(agent.id, accumulatedContext);
        responses.push({ agentId: agent.id, name: agent.name, content: response });

        // Add this response to context for next agent
        if (response.trim()) {
          accumulatedContext += `\n\n[${agent.name}]: ${response}`;
        }
      } catch (error) {
        console.error(`Agent ${agent.name} failed:`, error);
      }
    }

    return responses;
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
