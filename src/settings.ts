import { App, PluginSettingTab, Setting } from 'obsidian';
import type TherapistPlugin from './main';
import type { AgentRole } from './LettaService';

export interface AgentConfig {
  id: string;
  model: string;
  name: string;
  role: AgentRole;
  enabled: boolean;  // Whether this agent participates in responses
  order: number;     // Order in the response chain (lower = first)
}

export interface TherapistSettings {
  lettaUrl: string;
  apiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  agents: AgentConfig[];
  multiAgentMode: 'single' | 'sequential' | 'parallel';
  primaryAgentId: string;  // Fallback if only one agent needed
  enabled: boolean;
  debounceMs: number;
}

export const DEFAULT_SETTINGS: TherapistSettings = {
  lettaUrl: 'http://localhost:8283',
  apiKey: '',
  openaiApiKey: '',
  anthropicApiKey: '',
  agents: [],
  multiAgentMode: 'single',
  primaryAgentId: '',
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

    containerEl.createEl('h3', { text: 'Multi-Agent Configuration' });

    // Multi-agent mode selector
    new Setting(containerEl)
      .setName('Agent Mode')
      .setDesc('How agents work together')
      .addDropdown(dropdown => dropdown
        .addOption('single', 'Single Agent')
        .addOption('sequential', 'Sequential (agents respond in order)')
        .addOption('parallel', 'Parallel (all agents respond)')
        .setValue(this.plugin.settings.multiAgentMode)
        .onChange(async (value: 'single' | 'sequential' | 'parallel') => {
          this.plugin.settings.multiAgentMode = value;
          await this.plugin.saveSettings();
          this.display();
        }));

    // Primary agent selector (for single mode)
    if (this.plugin.settings.multiAgentMode === 'single' && this.plugin.settings.agents.length > 0) {
      new Setting(containerEl)
        .setName('Primary Agent')
        .setDesc('Which agent responds to your journal')
        .addDropdown(dropdown => {
          for (const agent of this.plugin.settings.agents) {
            dropdown.addOption(agent.id, `${agent.name} (${agent.role})`);
          }
          dropdown.setValue(this.plugin.settings.primaryAgentId);
          dropdown.onChange(async (value) => {
            this.plugin.settings.primaryAgentId = value;
            await this.plugin.saveSettings();
          });
        });
    }

    // List existing agents
    if (this.plugin.settings.agents.length > 0) {
      containerEl.createEl('h4', { text: 'Your Agents' });

      for (const agent of this.plugin.settings.agents) {
        const setting = new Setting(containerEl)
          .setName(`${agent.name} (${agent.role})`)
          .setDesc(`Model: ${agent.model}`);

        // Enable/disable toggle for multi-agent modes
        if (this.plugin.settings.multiAgentMode !== 'single') {
          setting.addToggle(toggle => toggle
            .setValue(agent.enabled)
            .setTooltip('Enable this agent')
            .onChange(async (value) => {
              agent.enabled = value;
              await this.plugin.saveSettings();
            }));
        }

        setting.addButton(button => button
          .setButtonText('Delete')
          .setWarning()
          .onClick(async () => {
            this.plugin.settings.agents = this.plugin.settings.agents.filter(a => a.id !== agent.id);
            if (this.plugin.settings.primaryAgentId === agent.id) {
              this.plugin.settings.primaryAgentId = this.plugin.settings.agents[0]?.id || '';
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
    let selectedRole: AgentRole = 'therapist';

    new Setting(containerEl)
      .setName('Agent Name')
      .addText(text => text
        .setPlaceholder('therapist')
        .setValue(agentName)
        .onChange(value => { agentName = value; }));

    new Setting(containerEl)
      .setName('Role')
      .setDesc('Agent\'s specialized function')
      .addDropdown(dropdown => dropdown
        .addOption('therapist', 'Therapist - primary responder')
        .addOption('analyst', 'Analyst - pattern recognition')
        .addOption('memory', 'Memory - recalls past sessions')
        .addOption('safety', 'Safety - monitors for concerns')
        .addOption('custom', 'Custom')
        .setValue(selectedRole)
        .onChange((value: AgentRole) => { selectedRole = value; }));

    new Setting(containerEl)
      .setName('Model')
      .setDesc('LLM to power this agent')
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
            const agentId = await this.plugin.lettaService.createAgent(
              agentName || selectedRole,
              selectedRole,
              selectedModel
            );
            const newAgent: AgentConfig = {
              id: agentId,
              model: selectedModel,
              name: agentName || selectedRole,
              role: selectedRole,
              enabled: true,
              order: this.plugin.settings.agents.length,
            };
            this.plugin.settings.agents.push(newAgent);
            if (!this.plugin.settings.primaryAgentId) {
              this.plugin.settings.primaryAgentId = agentId;
            }
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
          } catch (error) {
            console.error('Failed to fetch models:', error);
          }
        }));
  }
}
