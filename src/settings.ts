import { App, Notice, PluginSettingTab, Setting, requestUrl } from 'obsidian';
import type TherapistPlugin from './main';

export interface TherapistSettings {
  lettaUrl: string;
  apiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  agentId: string;  // Single agent, simple
  enabled: boolean;
  debounceMs: number;
  // Indexing settings
  autoIndex: boolean;
  indexMode: 'whitelist' | 'blacklist';
  indexFolders: string;  // Comma-separated folder paths
}

export const DEFAULT_SETTINGS: TherapistSettings = {
  lettaUrl: 'http://localhost:8283',
  apiKey: '',
  openaiApiKey: '',
  anthropicApiKey: '',
  agentId: '',
  enabled: true,
  debounceMs: 3000,
  autoIndex: true,
  indexMode: 'blacklist',
  indexFolders: '',  // Empty = index all (blacklist mode) or none (whitelist mode)
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

    // Model selector
    let selectedModel = 'letta/letta-free';
    let modelDropdown: any = null;

    new Setting(containerEl)
      .setName('Model')
      .setDesc('Click refresh to load available models')
      .addDropdown(dropdown => {
        modelDropdown = dropdown;
        dropdown.addOption('letta/letta-free', 'letta/letta-free (default)');
        dropdown.setValue(selectedModel);
        dropdown.onChange(value => { selectedModel = value; });
      })
      .addButton(button => button
        .setButtonText('Refresh')
        .onClick(async () => {
          try {
            const models = await this.plugin.lettaService.listModels();

            // Clear and repopulate
            modelDropdown.selectEl.empty();
            modelDropdown.addOption('letta/letta-free', 'letta/letta-free (default)');

            for (const model of models) {
              if (model.handle !== 'letta/letta-free') {
                modelDropdown.addOption(model.handle, model.handle);
              }
            }

            modelDropdown.setValue(selectedModel);
            new Notice(`Found ${models.length} models`);
          } catch (error) {
            new Notice('Failed to fetch models - check server connection');
          }
        }));

    if (hasAgent) {
      const agentSetting = new Setting(containerEl)
        .setName('Agent')
        .setDesc(`ID: ${this.plugin.settings.agentId}`)
        .addButton(button => button
          .setButtonText('Copy ID')
          .onClick(() => {
            navigator.clipboard.writeText(this.plugin.settings.agentId);
            new Notice('Agent ID copied');
          }))
        .addButton(button => button
          .setButtonText('Delete Agent')
          .setWarning()
          .onClick(async () => {
            try {
              await this.plugin.lettaService.deleteAgent(this.plugin.settings.agentId);
              new Notice('Agent deleted from Letta');
            } catch (e) {
              console.warn('Could not delete agent from Letta:', e);
              new Notice('Agent removed locally (could not delete from server)');
            }
            this.plugin.settings.agentId = '';
            await this.plugin.saveSettings();
            this.display();
          }));

      // Make the ID selectable
      const descEl = agentSetting.descEl;
      descEl.empty();
      const idSpan = descEl.createEl('code', {
        text: this.plugin.settings.agentId,
        cls: 'therapist-agent-id'
      });
      idSpan.style.userSelect = 'all';
      idSpan.style.fontSize = '0.85em';
    } else {
      new Setting(containerEl)
        .setName('Create Therapist')
        .setDesc('Creates your personal coach agent')
        .addButton(button => button
          .setButtonText('Create Agent')
          .setCta()
          .onClick(async () => {
            try {
              // Use selected model, default embedding to letta-free
              const model = selectedModel;
              const embedding = 'letta/letta-free';

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

    // Vault indexing
    if (hasAgent) {
      containerEl.createEl('h3', { text: 'Vault Context' });
      containerEl.createEl('p', {
        text: 'Notes with ## Journal headers are always indexed. Configure which other folders to include.',
        cls: 'setting-item-description',
      });

      new Setting(containerEl)
        .setName('Auto-index')
        .setDesc('Automatically index files when they change')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.autoIndex)
          .onChange(async (value) => {
            this.plugin.settings.autoIndex = value;
            await this.plugin.saveSettings();
            if (value) {
              this.plugin.startAutoIndexing();
            } else {
              this.plugin.stopAutoIndexing();
            }
          }));

      new Setting(containerEl)
        .setName('Folder mode')
        .setDesc('Whitelist: only index listed folders. Blacklist: index all except listed.')
        .addDropdown(dropdown => dropdown
          .addOption('blacklist', 'Blacklist (exclude folders)')
          .addOption('whitelist', 'Whitelist (only these folders)')
          .setValue(this.plugin.settings.indexMode)
          .onChange(async (value: 'whitelist' | 'blacklist') => {
            this.plugin.settings.indexMode = value;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('Folders')
        .setDesc('Comma-separated folder paths (e.g., "private, drafts, templates")')
        .addText(text => text
          .setPlaceholder('folder1, folder2')
          .setValue(this.plugin.settings.indexFolders)
          .onChange(async (value) => {
            this.plugin.settings.indexFolders = value;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('Reindex Vault')
        .setDesc('Full reindex of all matching files')
        .addButton(button => button
          .setButtonText('Reindex Now')
          .onClick(async () => {
            if (this.plugin.isIndexing) {
              new Notice('Indexing already in progress');
              return;
            }
            button.setDisabled(true);
            button.setButtonText('Indexing...');
            try {
              const filter = this.plugin.getIndexFilter();
              const result = await this.plugin.vaultIndexer.indexVault(
                this.plugin.settings.agentId,
                filter
              );
              new Notice(`Indexed ${result.files} files (${result.passages} passages)`);
            } catch (error) {
              console.error('Indexing failed:', error);
              new Notice(`Indexing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            } finally {
              button.setDisabled(false);
              button.setButtonText('Reindex Now');
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
            const url = `${this.plugin.settings.lettaUrl}/v1/health/`;
            new Notice(`Testing ${url}...`);
            const response = await requestUrl({ url });
            if (response.status === 200) {
              new Notice('Connected to Letta server!');
            } else {
              new Notice(`Server error: ${response.status}`);
            }
          } catch (error) {
            new Notice(`Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }));
  }
}
