import { App, PluginSettingTab, Setting } from 'obsidian';
import type TherapistPlugin from './main';

export interface AgentConfig {
  id: string;
  model: string;
  name: string;
}

export interface TherapistSettings {
  lettaUrl: string;
  apiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  agents: AgentConfig[];
  activeAgentId: string;
  enabled: boolean;
  debounceMs: number;
}

export const DEFAULT_SETTINGS: TherapistSettings = {
  lettaUrl: 'http://localhost:8283',
  apiKey: '',
  openaiApiKey: '',
  anthropicApiKey: '',
  agents: [],
  activeAgentId: '',
  enabled: true,
  debounceMs: 3000,
};

export class TherapistSettingTab extends PluginSettingTab {
  plugin: TherapistPlugin;

  constructor(app: App, plugin: TherapistPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Therapist Settings' });

    new Setting(containerEl)
      .setName('Enabled')
      .setDesc('Enable/disable the therapist')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enabled)
        .onChange(async (value) => {
          this.plugin.settings.enabled = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Letta Server URL')
      .setDesc('URL of your Letta server')
      .addText(text => text
        .setPlaceholder('http://localhost:8283')
        .setValue(this.plugin.settings.lettaUrl)
        .onChange(async (value) => {
          this.plugin.settings.lettaUrl = value;
          this.plugin.lettaService.setBaseUrl(value);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('API Key')
      .setDesc('Letta server API key (sk-let-...)')
      .addText(text => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('sk-let-...')
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value;
            this.plugin.lettaService.setApiKey(value);
            await this.plugin.saveSettings();
          });
      });

    containerEl.createEl('h3', { text: 'Cloud Provider Keys' });

    new Setting(containerEl)
      .setName('OpenAI API Key')
      .setDesc('For GPT-4, GPT-4o models')
      .addText(text => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('sk-proj-...')
          .setValue(this.plugin.settings.openaiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.openaiApiKey = value;
            this.plugin.lettaService.setProviderKey('openai', value);
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Anthropic API Key')
      .setDesc('For Claude models')
      .addText(text => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('sk-ant-...')
          .setValue(this.plugin.settings.anthropicApiKey)
          .onChange(async (value) => {
            this.plugin.settings.anthropicApiKey = value;
            this.plugin.lettaService.setProviderKey('anthropic', value);
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Response Delay')
      .setDesc('Seconds to wait after you stop typing before therapist responds')
      .addSlider(slider => slider
        .setLimits(1, 10, 1)
        .setValue(this.plugin.settings.debounceMs / 1000)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.debounceMs = value * 1000;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('h3', { text: 'Agents' });

    // Active agent selector
    if (this.plugin.settings.agents.length > 0) {
      new Setting(containerEl)
        .setName('Active Agent')
        .setDesc('Select which agent to use')
        .addDropdown(dropdown => {
          for (const agent of this.plugin.settings.agents) {
            dropdown.addOption(agent.id, `${agent.name} (${agent.model})`);
          }
          dropdown.setValue(this.plugin.settings.activeAgentId);
          dropdown.onChange(async (value) => {
            this.plugin.settings.activeAgentId = value;
            await this.plugin.saveSettings();
          });
        });

      // List existing agents with delete buttons
      for (const agent of this.plugin.settings.agents) {
        new Setting(containerEl)
          .setName(agent.name)
          .setDesc(`Model: ${agent.model} | ID: ${agent.id}`)
          .addButton(button => button
            .setButtonText('Delete')
            .setWarning()
            .onClick(async () => {
              this.plugin.settings.agents = this.plugin.settings.agents.filter(a => a.id !== agent.id);
              if (this.plugin.settings.activeAgentId === agent.id) {
                this.plugin.settings.activeAgentId = this.plugin.settings.agents[0]?.id || '';
              }
              await this.plugin.saveSettings();
              this.display();
            }));
      }
    }

    // Create new agent
    containerEl.createEl('h4', { text: 'Create New Agent' });

    let selectedModel = 'ollama/llama3.2';
    let agentName = 'therapist';

    new Setting(containerEl)
      .setName('Agent Name')
      .addText(text => text
        .setPlaceholder('therapist')
        .setValue(agentName)
        .onChange(value => { agentName = value; }));

    new Setting(containerEl)
      .setName('Model')
      .setDesc('Select model for the agent')
      .addText(text => text
        .setPlaceholder('ollama/llama3.2 or openai/gpt-4o')
        .setValue(selectedModel)
        .onChange(value => { selectedModel = value; }));

    new Setting(containerEl)
      .setName('')
      .addButton(button => button
        .setButtonText('Create Agent')
        .setCta()
        .onClick(async () => {
          try {
            const agentId = await this.plugin.lettaService.createAgent(selectedModel);
            const newAgent: AgentConfig = {
              id: agentId,
              model: selectedModel,
              name: agentName || 'therapist',
            };
            this.plugin.settings.agents.push(newAgent);
            this.plugin.settings.activeAgentId = agentId;
            await this.plugin.saveSettings();
            this.display();
          } catch (error) {
            console.error('Failed to create agent:', error);
          }
        }));

    // Refresh models button
    new Setting(containerEl)
      .setName('Available Models')
      .setDesc('Fetch list of models from server')
      .addButton(button => button
        .setButtonText('Refresh Models')
        .onClick(async () => {
          try {
            const models = await this.plugin.lettaService.listModels();
            const modelList = models.map(m => m.handle).join('\n');
            console.log('Available models:\n' + modelList);
            // Could show in a modal, for now just log
          } catch (error) {
            console.error('Failed to fetch models:', error);
          }
        }));
  }
}
