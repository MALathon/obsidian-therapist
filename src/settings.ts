import { App, Notice, PluginSettingTab, Setting, requestUrl } from 'obsidian';
import type TherapistPlugin from './main';

export interface TherapistSettings {
  lettaUrl: string;
  apiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  agentId: string;
  agentName: string;  // Cached agent name from Letta
  agentModel: string; // Cached agent model
  therapistName: string; // Custom display name for the therapist
  enabled: boolean;
  debounceMs: number;
}

export const DEFAULT_SETTINGS: TherapistSettings = {
  lettaUrl: 'http://localhost:8283',
  apiKey: '',
  openaiApiKey: '',
  anthropicApiKey: '',
  agentId: '',
  agentName: '',
  agentModel: '',
  therapistName: 'Therapist',
  enabled: true,
  debounceMs: 3000,
};

export class TherapistSettingTab extends PluginSettingTab {
  plugin: TherapistPlugin;

  constructor(app: App, plugin: TherapistPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  async display(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();

    const hasAgent = !!this.plugin.settings.agentId;

    // Fetch agent details if we have an agent but no cached info
    if (hasAgent && !this.plugin.settings.agentName) {
      const agent = await this.plugin.lettaService.getAgent(this.plugin.settings.agentId);
      if (agent) {
        this.plugin.settings.agentName = agent.name;
        this.plugin.settings.agentModel = agent.model;
        await this.plugin.saveSettings();
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // AGENT SECTION (show first when connected - it's what matters)
    // ═══════════════════════════════════════════════════════════════
    if (hasAgent) {
      containerEl.createEl('h2', { text: 'Your Therapist' });

      // Therapist name - editable
      new Setting(containerEl)
        .setName('Name')
        .setDesc('What should your therapist call themselves?')
        .addText(text => text
          .setPlaceholder('Therapist')
          .setValue(this.plugin.settings.therapistName)
          .onChange(async (value) => {
            this.plugin.settings.therapistName = value || 'Therapist';
            await this.plugin.saveSettings();
          }));

      // Model info (read-only)
      const modelSetting = new Setting(containerEl)
        .setName('Model');
      modelSetting.descEl.createSpan({
        text: this.plugin.settings.agentModel || 'unknown',
        cls: 'therapist-model-badge'
      });

      // Enable/disable toggle
      new Setting(containerEl)
        .setName('Active')
        .setDesc('Turn the therapist on or off')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.enabled)
          .onChange(async (value) => {
            this.plugin.settings.enabled = value;
            await this.plugin.saveSettings();
            this.plugin.updateStatusBar();
          }));

      // Agent ID (collapsible/subtle)
      const idSetting = new Setting(containerEl)
        .setName('Agent ID')
        .addButton(button => button
          .setButtonText('Copy')
          .onClick(() => {
            navigator.clipboard.writeText(this.plugin.settings.agentId);
            new Notice('Agent ID copied');
          }))
        .addButton(button => button
          .setButtonText('Delete')
          .setWarning()
          .onClick(async () => {
            try {
              await this.plugin.lettaService.deleteAgent(this.plugin.settings.agentId);
              new Notice('Agent deleted');
            } catch (e) {
              console.warn('Could not delete from server:', e);
            }
            this.plugin.settings.agentId = '';
            this.plugin.settings.agentName = '';
            this.plugin.settings.agentModel = '';
            this.plugin.settings.therapistName = 'Therapist';
            await this.plugin.saveSettings();
            this.display();
          }));

      // Show ID in description
      const descEl = idSetting.descEl;
      const idCode = descEl.createEl('code', { text: this.plugin.settings.agentId });
      idCode.style.fontSize = '0.75em';
      idCode.style.userSelect = 'all';
    }

    // ═══════════════════════════════════════════════════════════════
    // CREATE AGENT (only when no agent)
    // ═══════════════════════════════════════════════════════════════
    if (!hasAgent) {
      containerEl.createEl('h2', { text: 'Create Therapist' });

      let selectedModel = 'letta/letta-free';
      let modelDropdown: any = null;

      new Setting(containerEl)
        .setName('Model')
        .setDesc('Select which AI model to use')
        .addDropdown(dropdown => {
          modelDropdown = dropdown;
          dropdown.addOption('letta/letta-free', 'letta/letta-free (free)');
          dropdown.setValue(selectedModel);
          dropdown.onChange(value => { selectedModel = value; });
        })
        .addButton(button => button
          .setButtonText('Refresh Models')
          .onClick(async () => {
            try {
              const models = await this.plugin.lettaService.listModels();
              modelDropdown.selectEl.empty();
              modelDropdown.addOption('letta/letta-free', 'letta/letta-free (free)');
              for (const model of models) {
                if (model.handle !== 'letta/letta-free') {
                  modelDropdown.addOption(model.handle, model.handle);
                }
              }
              modelDropdown.setValue(selectedModel);
              new Notice(`Found ${models.length} models`);
            } catch (error) {
              new Notice('Failed to fetch models');
            }
          }));

      new Setting(containerEl)
        .setName('')
        .addButton(button => button
          .setButtonText('Create Therapist')
          .setCta()
          .onClick(async () => {
            try {
              new Notice(`Creating agent with ${selectedModel}...`);
              const agentId = await this.plugin.lettaService.createAgent(
                'therapist',
                'therapist',
                selectedModel,
                'letta/letta-free'
              );
              this.plugin.settings.agentId = agentId;
              this.plugin.settings.agentModel = selectedModel;
              this.plugin.settings.agentName = 'therapist';
              await this.plugin.saveSettings();
              new Notice('Therapist created! Start journaling.');
              this.display();
            } catch (error) {
              console.error('Failed to create agent:', error);
              new Notice(`Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
          }));
    }

    // ═══════════════════════════════════════════════════════════════
    // BEHAVIOR
    // ═══════════════════════════════════════════════════════════════
    containerEl.createEl('h3', { text: 'Behavior' });

    new Setting(containerEl)
      .setName('Response delay')
      .setDesc('Seconds to wait after you stop typing before responding')
      .addSlider(slider => slider
        .setLimits(1, 10, 1)
        .setValue(this.plugin.settings.debounceMs / 1000)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.debounceMs = value * 1000;
          await this.plugin.saveSettings();
        }));

    // ═══════════════════════════════════════════════════════════════
    // SERVER CONNECTION
    // ═══════════════════════════════════════════════════════════════
    containerEl.createEl('h3', { text: 'Server' });

    new Setting(containerEl)
      .setName('Letta URL')
      .setDesc('Your Letta server address')
      .addText(text => text
        .setPlaceholder('http://localhost:8283')
        .setValue(this.plugin.settings.lettaUrl)
        .onChange(async (value) => {
          this.plugin.settings.lettaUrl = value;
          this.plugin.lettaService.setBaseUrl(value);
          await this.plugin.saveSettings();
        }))
      .addButton(button => button
        .setButtonText('Test')
        .onClick(async () => {
          try {
            const url = `${this.plugin.settings.lettaUrl}/v1/health/`;
            const response = await requestUrl({ url });
            if (response.status === 200) {
              new Notice('Connected!');
            } else {
              new Notice(`Error: ${response.status}`);
            }
          } catch (error) {
            new Notice(`Connection failed`);
          }
        }));

    new Setting(containerEl)
      .setName('Letta API Key')
      .setDesc('Only needed if your server requires authentication')
      .addText(text => text
        .setPlaceholder('sk-let-...')
        .setValue(this.plugin.settings.apiKey)
        .onChange(async (value) => {
          this.plugin.settings.apiKey = value;
          this.plugin.lettaService.setApiKey(value);
          await this.plugin.saveSettings();
        }));

    // ═══════════════════════════════════════════════════════════════
    // API KEYS
    // ═══════════════════════════════════════════════════════════════
    containerEl.createEl('h3', { text: 'LLM API Keys' });
    containerEl.createEl('p', {
      text: 'Required for cloud models. Leave blank if using letta-free or local Ollama.',
      cls: 'setting-item-description',
    });

    new Setting(containerEl)
      .setName('Anthropic')
      .setDesc('For Claude models')
      .addText(text => text
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
        }));

    new Setting(containerEl)
      .setName('OpenAI')
      .setDesc('For GPT models')
      .addText(text => text
        .setPlaceholder('sk-proj-...')
        .setValue(this.plugin.settings.openaiApiKey)
        .onChange(async (value) => {
          this.plugin.settings.openaiApiKey = value;
          await this.plugin.saveSettings();
          if (value) {
            try {
              await this.plugin.lettaService.updateProviderKey('openai', value);
            } catch (e) {
              console.warn('Could not update provider key:', e);
            }
          }
        }));
  }
}
