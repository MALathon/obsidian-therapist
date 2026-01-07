import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type TherapistPlugin from './main';

export interface TherapistSettings {
  lettaUrl: string;
  apiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  agentId: string;  // Single agent, simple
  enabled: boolean;
  debounceMs: number;
}

export const DEFAULT_SETTINGS: TherapistSettings = {
  lettaUrl: 'http://localhost:8283',
  apiKey: '',
  openaiApiKey: '',
  anthropicApiKey: '',
  agentId: '',
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

    containerEl.createEl('h2', { text: 'Therapist' });

    // Status indicator
    const hasAgent = !!this.plugin.settings.agentId;
    const statusEl = containerEl.createEl('div', {
      cls: 'setting-item',
    });
    statusEl.createEl('span', {
      text: hasAgent ? '✓ Connected' : '○ No agent configured',
      cls: hasAgent ? 'therapist-status-connected' : 'therapist-status-disconnected',
    });

    new Setting(containerEl)
      .setName('Enabled')
      .setDesc('Enable/disable the therapist')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enabled)
        .onChange(async (value) => {
          this.plugin.settings.enabled = value;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('h3', { text: 'Connection' });

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
      .setName('Letta API Key')
      .setDesc('Optional - only if your server requires it')
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

    containerEl.createEl('h3', { text: 'LLM Provider' });
    containerEl.createEl('p', {
      text: 'Add an API key to use cloud models. Leave blank to use local Ollama.',
      cls: 'setting-item-description',
    });

    new Setting(containerEl)
      .setName('OpenAI API Key')
      .setDesc('Uses GPT-4o')
      .addText(text => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('sk-proj-...')
          .setValue(this.plugin.settings.openaiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.openaiApiKey = value;
            await this.plugin.saveSettings();
            // Update provider on server
            if (value) {
              try {
                await this.plugin.lettaService.updateProviderKey('openai', value);
              } catch (e) {
                console.warn('Could not update provider key:', e);
              }
            }
          });
      });

    new Setting(containerEl)
      .setName('Anthropic API Key')
      .setDesc('Uses Claude Sonnet')
      .addText(text => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('sk-ant-...')
          .setValue(this.plugin.settings.anthropicApiKey)
          .onChange(async (value) => {
            this.plugin.settings.anthropicApiKey = value;
            await this.plugin.saveSettings();
            if (value) {
              try {
                await this.plugin.lettaService.updateProviderKey('anthropic', value);
              } catch (e) {
                console.warn('Could not update provider key:', e);
              }
            }
          });
      });

    containerEl.createEl('h3', { text: 'Behavior' });

    new Setting(containerEl)
      .setName('Response Delay')
      .setDesc('Seconds to wait after you stop typing')
      .addSlider(slider => slider
        .setLimits(1, 10, 1)
        .setValue(this.plugin.settings.debounceMs / 1000)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.debounceMs = value * 1000;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('h3', { text: 'Setup' });

    if (hasAgent) {
      new Setting(containerEl)
        .setName('Agent')
        .setDesc(`ID: ${this.plugin.settings.agentId}`)
        .addButton(button => button
          .setButtonText('Delete Agent')
          .setWarning()
          .onClick(async () => {
            this.plugin.settings.agentId = '';
            await this.plugin.saveSettings();
            new Notice('Agent removed');
            this.display();
          }));
    } else {
      new Setting(containerEl)
        .setName('Create Therapist')
        .setDesc('Creates your personal coach agent')
        .addButton(button => button
          .setButtonText('Create Agent')
          .setCta()
          .onClick(async () => {
            try {
              // Pick model based on available API keys
              let model = 'ollama/llama3.2';  // default fallback
              let embedding = 'ollama/nomic-embed-text';

              if (this.plugin.settings.anthropicApiKey) {
                model = 'anthropic/claude-sonnet-4-20250514';
                embedding = 'openai/text-embedding-3-small';
              } else if (this.plugin.settings.openaiApiKey) {
                model = 'openai/gpt-4o';
                embedding = 'openai/text-embedding-3-small';
              }

              new Notice(`Creating agent with ${model}...`);

              const agentId = await this.plugin.lettaService.createAgent(
                'therapist',
                'therapist',
                model,
                embedding
              );

              this.plugin.settings.agentId = agentId;
              await this.plugin.saveSettings();
              new Notice('Therapist created! Start journaling.');
              this.display();
            } catch (error) {
              console.error('Failed to create agent:', error);
              new Notice(`Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
          }));
    }

    // Test connection button
    new Setting(containerEl)
      .setName('Test Connection')
      .setDesc('Check if Letta server is reachable')
      .addButton(button => button
        .setButtonText('Test')
        .onClick(async () => {
          try {
            const healthy = await this.plugin.lettaService.healthCheck();
            if (healthy) {
              new Notice('Connected to Letta server');
            } else {
              new Notice('Server responded but not healthy');
            }
          } catch (error) {
            new Notice('Cannot reach Letta server');
          }
        }));
  }
}
