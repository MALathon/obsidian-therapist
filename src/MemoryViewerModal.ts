import { Modal, App, Notice } from 'obsidian';
import type { LettaService } from './LettaService';

interface MemoryBlock {
  id: string;
  label: string;
  value: string;
}

interface ArchivalMemory {
  id: string;
  text: string;
  created_at: string;
}

export class MemoryViewerModal extends Modal {
  private lettaService: LettaService;
  private agentId: string;
  private activeTab: 'blocks' | 'archival' = 'blocks';
  private memoryBlocks: MemoryBlock[] = [];
  private archivalMemories: ArchivalMemory[] = [];
  private isLoading = true;

  constructor(app: App, lettaService: LettaService, agentId: string) {
    super(app);
    this.lettaService = lettaService;
    this.agentId = agentId;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass('therapist-memory-modal');
    contentEl.empty();

    contentEl.createEl('h2', { text: 'Therapist Memory' });

    // Create tabs
    const tabsEl = contentEl.createDiv({ cls: 'therapist-memory-tabs' });

    const blocksTab = tabsEl.createEl('button', {
      text: 'Core Memory',
      cls: 'therapist-memory-tab is-active'
    });
    const archivalTab = tabsEl.createEl('button', {
      text: 'Archival Memory',
      cls: 'therapist-memory-tab'
    });

    blocksTab.addEventListener('click', () => {
      this.activeTab = 'blocks';
      blocksTab.addClass('is-active');
      archivalTab.removeClass('is-active');
      this.renderContent();
    });

    archivalTab.addEventListener('click', () => {
      this.activeTab = 'archival';
      archivalTab.addClass('is-active');
      blocksTab.removeClass('is-active');
      this.renderContent();
    });

    // Content container
    contentEl.createDiv({ cls: 'therapist-memory-content' });

    // Load data
    await this.loadData();
    this.renderContent();
  }

  private async loadData() {
    this.isLoading = true;
    try {
      const [blocks, archival] = await Promise.all([
        this.lettaService.getMemoryBlocks(this.agentId),
        this.lettaService.getArchivalMemory(this.agentId, 100),
      ]);
      this.memoryBlocks = blocks;
      this.archivalMemories = archival;
    } catch (error) {
      console.error('Failed to load memory:', error);
      new Notice('Failed to load memory');
    }
    this.isLoading = false;
  }

  private renderContent() {
    const contentEl = this.contentEl.querySelector('.therapist-memory-content');
    if (!contentEl) return;

    contentEl.empty();

    if (this.isLoading) {
      contentEl.createDiv({ text: 'Loading...', cls: 'therapist-memory-empty' });
      return;
    }

    if (this.activeTab === 'blocks') {
      this.renderMemoryBlocks(contentEl as HTMLElement);
    } else {
      this.renderArchivalMemory(contentEl as HTMLElement);
    }
  }

  private renderMemoryBlocks(container: HTMLElement) {
    const section = container.createDiv({ cls: 'therapist-memory-section' });
    section.createEl('h3', { text: 'Core Memory Blocks' });
    section.createEl('p', {
      text: 'These are the core memories your therapist maintains about you and their persona.',
      cls: 'setting-item-description'
    });

    if (this.memoryBlocks.length === 0) {
      section.createDiv({ text: 'No memory blocks found', cls: 'therapist-memory-empty' });
      return;
    }

    for (const block of this.memoryBlocks) {
      const blockEl = section.createDiv({ cls: 'therapist-memory-block' });

      const headerEl = blockEl.createDiv({ cls: 'therapist-memory-block-header' });
      headerEl.createSpan({ text: block.label, cls: 'therapist-memory-block-label' });

      const contentEl = blockEl.createDiv({ cls: 'therapist-memory-block-content' });
      contentEl.setText(block.value);

      // Only allow editing 'human' block (not persona)
      if (block.label === 'human') {
        const editBtn = headerEl.createEl('button', { text: 'Edit', cls: 'therapist-memory-delete' });
        editBtn.addEventListener('click', () => this.editMemoryBlock(block));
      }
    }
  }

  private renderArchivalMemory(container: HTMLElement) {
    const section = container.createDiv({ cls: 'therapist-memory-section' });

    const headerEl = section.createDiv({ cls: 'therapist-memory-header' });
    headerEl.createEl('h3', { text: 'Archival Memories' });

    const addBtn = headerEl.createEl('button', { text: '+ Add Memory', cls: 'therapist-memory-add' });
    addBtn.addEventListener('click', () => this.addArchivalMemory());

    section.createEl('p', {
      text: 'Long-term memories your therapist has stored. These are facts and observations the agent has explicitly chosen to remember.',
      cls: 'setting-item-description'
    });

    if (this.archivalMemories.length === 0) {
      section.createDiv({
        text: 'No archival memories yet. Your therapist will build memories as you interact.',
        cls: 'therapist-memory-empty'
      });
      return;
    }

    // Sort by date, newest first
    const sorted = [...this.archivalMemories].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    for (const memory of sorted) {
      const itemEl = section.createDiv({ cls: 'therapist-memory-item' });

      const contentEl = itemEl.createDiv({ cls: 'therapist-memory-item-content' });
      contentEl.createDiv({ text: memory.text });

      const date = new Date(memory.created_at);
      contentEl.createDiv({
        text: date.toLocaleDateString() + ' ' + date.toLocaleTimeString(),
        cls: 'therapist-memory-item-date'
      });

      const actionsEl = itemEl.createDiv({ cls: 'therapist-memory-item-actions' });
      const deleteBtn = actionsEl.createEl('button', { text: 'Delete', cls: 'therapist-memory-delete' });
      deleteBtn.addEventListener('click', async () => {
        try {
          await this.lettaService.deleteArchivalMemory(this.agentId, memory.id);
          this.archivalMemories = this.archivalMemories.filter(m => m.id !== memory.id);
          this.renderContent();
          new Notice('Memory deleted');
        } catch (error) {
          console.error('Failed to delete memory:', error);
          new Notice('Failed to delete memory');
        }
      });
    }
  }

  private async editMemoryBlock(block: MemoryBlock) {
    // Create a simple edit modal - use label for API call
    const editModal = new EditMemoryModal(this.app, block.value, async (newValue) => {
      try {
        await this.lettaService.updateMemoryBlock(this.agentId, block.label, newValue);
        block.value = newValue;
        this.renderContent();
        new Notice('Memory updated');
      } catch (error) {
        console.error('Failed to update memory:', error);
        new Notice('Failed to update memory');
      }
    });
    editModal.open();
  }

  private async addArchivalMemory() {
    const editModal = new EditMemoryModal(this.app, '', async (text) => {
      if (!text.trim()) return;
      try {
        await this.lettaService.addArchivalMemory(this.agentId, text);
        await this.loadData();
        this.renderContent();
        new Notice('Memory added');
      } catch (error) {
        console.error('Failed to add memory:', error);
        new Notice('Failed to add memory');
      }
    }, 'Add Memory');
    editModal.open();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

class EditMemoryModal extends Modal {
  private value: string;
  private onSave: (value: string) => Promise<void>;
  private title: string;

  constructor(app: App, value: string, onSave: (value: string) => Promise<void>, title: string = 'Edit Memory') {
    super(app);
    this.value = value;
    this.onSave = onSave;
    this.title = title;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: this.title });

    const textarea = contentEl.createEl('textarea', {
      cls: 'therapist-memory-edit-textarea',
    });
    textarea.value = this.value;
    textarea.style.width = '100%';
    textarea.style.height = '300px';
    textarea.style.resize = 'vertical';
    textarea.style.fontFamily = 'var(--font-monospace)';
    textarea.style.fontSize = '13px';
    textarea.style.padding = '12px';
    textarea.style.marginBottom = '16px';

    const buttonsEl = contentEl.createDiv({ cls: 'therapist-memory-edit-buttons' });
    buttonsEl.style.display = 'flex';
    buttonsEl.style.gap = '8px';
    buttonsEl.style.justifyContent = 'flex-end';

    const cancelBtn = buttonsEl.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = buttonsEl.createEl('button', { text: 'Save', cls: 'mod-cta' });
    saveBtn.addEventListener('click', async () => {
      saveBtn.setAttr('disabled', 'true');
      saveBtn.setText('Saving...');
      await this.onSave(textarea.value);
      this.close();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
