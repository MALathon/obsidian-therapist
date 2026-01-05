import { App, PluginSettingTab, Setting } from 'obsidian';
import type TherapistPlugin from './main';

export interface TherapistSettings {
  lettaUrl: string;
  agentId: string;
  enabled: boolean;
  debounceMs: number;
  model: string;
}

export const DEFAULT_SETTINGS: TherapistSettings = {
  lettaUrl: 'http://localhost:8283',
  agentId: '',
  enabled: true,
  debounceMs: 3000,
  model: 'ollama/llama3.2'
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

    new Setting(containerEl)
      .setName('Model')
      .setDesc('LLM model to use (e.g., ollama/llama3.2)')
      .addText(text => text
        .setPlaceholder('ollama/llama3.2')
        .setValue(this.plugin.settings.model)
        .onChange(async (value) => {
          this.plugin.settings.model = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Agent ID')
      .setDesc('Letta agent ID (auto-generated on first run)')
      .addText(text => text
        .setPlaceholder('agent-xxx')
        .setValue(this.plugin.settings.agentId)
        .onChange(async (value) => {
          this.plugin.settings.agentId = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Reset Agent')
      .setDesc('Create a new therapist agent (loses memory)')
      .addButton(button => button
        .setButtonText('Reset')
        .setWarning()
        .onClick(async () => {
          this.plugin.settings.agentId = '';
          await this.plugin.saveSettings();
          await this.plugin.initializeAgent();
          this.display(); // Refresh to show new agent ID
        }));
  }
}
