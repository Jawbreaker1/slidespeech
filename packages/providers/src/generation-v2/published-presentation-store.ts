import { mkdir, readFile, readdir, writeFile, link, unlink } from "node:fs/promises";
import { join } from "node:path";
import { GenerationArtifactIdSchema, PublishedPresentationRecordSchema, PublishedLibraryQuerySchema } from "@slidespeech/types";
import type { PublishedPresentationRecord, PublishedLibraryQuery, PublishedLibraryItem, PublishedLibraryPage } from "@slidespeech/types";

/** V2 publications are write-once; this store never repairs or regenerates them. */
export class PublishedPresentationStore {
  constructor(private readonly root: string) {}
  async save(input: PublishedPresentationRecord): Promise<void> {
    const record = PublishedPresentationRecordSchema.parse(input);
    await mkdir(this.root, { recursive: true });
    await writeFile(join(this.root, `${record.presentation.artifactId}.json`), JSON.stringify(record), { flag: "wx" });
  }
  async get(id: string): Promise<PublishedPresentationRecord | undefined> {
    GenerationArtifactIdSchema.parse(id);
    try {
      const record = PublishedPresentationRecordSchema.parse(JSON.parse(await readFile(join(this.root, `${id}.json`), "utf8")));
      if (record.presentation.artifactId !== id) throw new Error("Publication identity mismatch.");
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async list(options: Partial<PublishedLibraryQuery> = {}): Promise<PublishedLibraryPage> {
    const { offset, limit, query, order } = PublishedLibraryQuerySchema.parse(options);
    const files = await readdir(this.root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const items: PublishedLibraryItem[] = [];
    let unavailableCount = 0;
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".json")) continue;
      const id = file.name.slice(0, -5);
      if (!GenerationArtifactIdSchema.safeParse(id).success) { unavailableCount++; continue; }
      let record: PublishedPresentationRecord | undefined;
      try { record = await this.get(id); }
      catch (error) {
        // Invalid publications are reported, never repaired or replaced with old sessions.
        if ((error as NodeJS.ErrnoException).code) throw error;
        unavailableCount++; continue;
      }
      if (!record) continue;
      const { presentation, scenes } = record;
      const title = scenes[0]!.title;
      const subject = presentation.classification.subject;
      if (query && !`${title} ${subject}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) continue;
      items.push({ id, title, subject, publishedAt: presentation.publishedAt,
        slideCount: scenes.length, imageCount: scenes.filter(scene => scene.elements.some(element => element.kind === "image")).length,
        language: presentation.strategy.language, cover: scenes[0]! });
    }
    items.sort((a, b) => (order === "newest" ? b.publishedAt.localeCompare(a.publishedAt) : a.publishedAt.localeCompare(b.publishedAt)) || a.id.localeCompare(b.id));
    return { items: items.slice(offset, offset + limit), total: items.length, unavailableCount,
      nextOffset: offset + limit < items.length ? offset + limit : null };
  }

  async archive(id: string): Promise<boolean> {
    GenerationArtifactIdSchema.parse(id);
    const archived = join(this.root, "archived");
    await mkdir(archived, { recursive: true });
    const source = join(this.root, `${id}.json`);
    try {
      // Keep an exact recoverable copy; never overwrite a previous archive.
      await link(source, join(archived, `${id}.json`));
      await unlink(source);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
}
