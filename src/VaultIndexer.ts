import { App, TFile, Notice } from 'obsidian';
import { LettaService } from './LettaService';

const ARCHIVE_NAME = 'obsidian-vault';
const CHUNK_SIZE = 1000; // Characters per passage
const CHUNK_OVERLAP = 100; // Overlap between chunks

export interface IndexFilter {
  mode: 'whitelist' | 'blacklist';
  folders: string[];
}

/**
 * Service for indexing vault content into Letta archival memory
 */
export class VaultIndexer {
  private app: App;
  private lettaService: LettaService;
  private archiveId: string | null = null;

  constructor(app: App, lettaService: LettaService) {
    this.app = app;
    this.lettaService = lettaService;
  }

  /**
   * Check if file has a ## Journal header
   */
  private async hasJournalHeader(file: TFile): Promise<boolean> {
    const content = await this.app.vault.cachedRead(file);
    return /^##\s+Journal\s*$/m.test(content);
  }

  /**
   * Check if file should be indexed based on filter settings
   */
  async shouldIndexFile(file: TFile, filter: IndexFilter): Promise<boolean> {
    // Always index files with ## Journal header
    if (await this.hasJournalHeader(file)) {
      return true;
    }

    const filePath = file.path.toLowerCase();
    const folders = filter.folders.map(f => f.trim().toLowerCase()).filter(f => f);

    if (folders.length === 0) {
      // No folders specified: blacklist = index all, whitelist = index none (except journals)
      return filter.mode === 'blacklist';
    }

    const matchesFolder = folders.some(folder =>
      filePath.startsWith(folder + '/') || filePath === folder
    );

    if (filter.mode === 'whitelist') {
      return matchesFolder;
    } else {
      return !matchesFolder;
    }
  }

  /**
   * Get or create the vault archive
   */
  private async getOrCreateArchive(): Promise<string> {
    if (this.archiveId) {
      return this.archiveId;
    }

    // Check if archive already exists
    const archives = await this.lettaService.listArchives();
    const existing = archives.find(a => a.name === ARCHIVE_NAME);

    if (existing) {
      this.archiveId = existing.id;
      return existing.id;
    }

    // Create new archive
    this.archiveId = await this.lettaService.createArchive(ARCHIVE_NAME);
    return this.archiveId;
  }

  /**
   * Split text into overlapping chunks
   */
  private chunkText(text: string, fileName: string): Array<{ text: string; metadata: Record<string, string> }> {
    const chunks: Array<{ text: string; metadata: Record<string, string> }> = [];

    if (text.length <= CHUNK_SIZE) {
      chunks.push({
        text: `[${fileName}]\n\n${text}`,
        metadata: { file: fileName, chunk: '0' },
      });
      return chunks;
    }

    let start = 0;
    let chunkIndex = 0;

    while (start < text.length) {
      const end = Math.min(start + CHUNK_SIZE, text.length);
      const chunk = text.substring(start, end);

      chunks.push({
        text: `[${fileName} - Part ${chunkIndex + 1}]\n\n${chunk}`,
        metadata: { file: fileName, chunk: String(chunkIndex) },
      });

      start = end - CHUNK_OVERLAP;
      if (start >= text.length - CHUNK_OVERLAP) break;
      chunkIndex++;
    }

    return chunks;
  }

  /**
   * Index a single file
   */
  private async indexFile(file: TFile, archiveId: string): Promise<number> {
    const content = await this.app.vault.cachedRead(file);

    // Skip very short files
    if (content.length < 50) {
      return 0;
    }

    const chunks = this.chunkText(content, file.path);

    for (const chunk of chunks) {
      await this.lettaService.addPassage(archiveId, chunk.text, chunk.metadata);
    }

    return chunks.length;
  }

  /**
   * Index all markdown files in the vault that match the filter
   */
  async indexVault(
    agentId: string,
    filter?: IndexFilter,
    onProgress?: (current: number, total: number, fileName: string) => void
  ): Promise<{ files: number; passages: number }> {
    const archiveId = await this.getOrCreateArchive();

    // Clear existing passages for fresh index
    new Notice('Clearing old index...');
    await this.lettaService.clearArchive(archiveId);

    // Get all markdown files
    const allFiles = this.app.vault.getMarkdownFiles();

    // Filter files based on settings
    const files: TFile[] = [];
    if (filter) {
      for (const file of allFiles) {
        if (await this.shouldIndexFile(file, filter)) {
          files.push(file);
        }
      }
    } else {
      files.push(...allFiles);
    }

    let totalPassages = 0;

    new Notice(`Indexing ${files.length} files...`);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (onProgress) {
        onProgress(i + 1, files.length, file.path);
      }

      try {
        const passages = await this.indexFile(file, archiveId);
        totalPassages += passages;
      } catch (error) {
        console.warn(`Failed to index ${file.path}:`, error);
      }
    }

    // Attach archive to agent
    try {
      await this.lettaService.attachArchive(agentId, archiveId);
    } catch (error) {
      // May already be attached
      console.warn('Archive attachment:', error);
    }

    new Notice(`Indexed ${files.length} files (${totalPassages} passages)`);

    return { files: files.length, passages: totalPassages };
  }

  /**
   * Index a single file (for auto-indexing on change)
   */
  async indexSingleFile(file: TFile, agentId: string, filter?: IndexFilter): Promise<boolean> {
    // Check if file should be indexed
    if (filter && !(await this.shouldIndexFile(file, filter))) {
      return false;
    }

    const archiveId = await this.getOrCreateArchive();

    try {
      // Note: This adds new passages without removing old ones for the same file
      // For a production system, you'd want to track and update passages by file
      await this.indexFile(file, archiveId);

      // Ensure archive is attached
      try {
        await this.lettaService.attachArchive(agentId, archiveId);
      } catch {
        // Already attached
      }

      return true;
    } catch (error) {
      console.warn(`Failed to index ${file.path}:`, error);
      return false;
    }
  }

  /**
   * Index only files that have changed since last index
   * (For future incremental indexing)
   */
  async indexChanged(agentId: string, since: number): Promise<{ files: number; passages: number }> {
    const archiveId = await this.getOrCreateArchive();

    const files = this.app.vault.getMarkdownFiles()
      .filter(f => f.stat.mtime > since);

    let totalPassages = 0;

    for (const file of files) {
      try {
        const passages = await this.indexFile(file, archiveId);
        totalPassages += passages;
      } catch (error) {
        console.warn(`Failed to index ${file.path}:`, error);
      }
    }

    return { files: files.length, passages: totalPassages };
  }
}
