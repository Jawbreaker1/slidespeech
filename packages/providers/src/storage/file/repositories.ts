import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import type {
  Deck,
  DeckRepository,
  Session,
  SessionRepository,
  TranscriptRepository,
  TranscriptTurn,
  UserPreferences,
  UserPreferencesRepository,
} from "@slidespeech/types";

import { readJsonFile, writeJsonFile } from "../../shared";

export interface FileStorageConfig {
  rootDir: string;
}

class FileRepositoryBase {
  constructor(protected readonly config: FileStorageConfig) {}

  protected pathFor(collection: string, id: string): string {
    return join(this.config.rootDir, collection, `${id}.json`);
  }

  protected async listCollection<T>(collection: string): Promise<T[]> {
    const directory = join(this.config.rootDir, collection);

    try {
      const entries = await readdir(directory);
      const values = await Promise.all(
        entries
          .filter((entry) => entry.endsWith(".json"))
          .map(async (entry) => {
            const filePath = join(directory, entry);

            try {
              return await readJsonFile<T>(filePath);
            } catch (error) {
              console.warn(
                `[slidespeech] skipping malformed ${collection} file ${filePath}: ${(error as Error).message}`,
              );
              return null;
            }
          }),
      );

      const result: T[] = [];

      for (const value of values) {
        if (value !== null) {
          result.push(value);
        }
      }

      return result;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }
}

export class FileDeckRepository
  extends FileRepositoryBase
  implements DeckRepository
{
  async save(deck: Deck): Promise<void> {
    await writeJsonFile(this.pathFor("decks", deck.id), deck);
  }

  async getById(id: string): Promise<Deck | null> {
    return readJsonFile<Deck>(this.pathFor("decks", id));
  }

  async list(): Promise<Deck[]> {
    return this.listCollection<Deck>("decks");
  }

  async delete(id: string): Promise<void> {
    await rm(this.pathFor("decks", id), { force: true });
  }
}

export class FileSessionRepository
  extends FileRepositoryBase
  implements SessionRepository
{
  async save(session: Session): Promise<void> {
    await writeJsonFile(this.pathFor("sessions", session.id), session);
  }

  async getById(id: string): Promise<Session | null> {
    return readJsonFile<Session>(this.pathFor("sessions", id));
  }

  async list(): Promise<Session[]> {
    return this.listCollection<Session>("sessions");
  }

  async delete(id: string): Promise<void> {
    await rm(this.pathFor("sessions", id), { force: true });
  }
}

export class FileTranscriptRepository
  extends FileRepositoryBase
  implements TranscriptRepository
{
  async append(turn: TranscriptTurn): Promise<void> {
    await writeJsonFile(this.pathFor("transcripts", turn.id), turn);
  }

  async listBySessionId(sessionId: string): Promise<TranscriptTurn[]> {
    const turns = await this.listCollection<TranscriptTurn>("transcripts");
    return turns
      .filter((turn) => turn.sessionId === sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async deleteBySessionId(sessionId: string): Promise<void> {
    const turns = await this.listBySessionId(sessionId);
    await Promise.all(
      turns.map((turn) => rm(this.pathFor("transcripts", turn.id), { force: true })),
    );
  }
}

export class FileUserPreferencesRepository
  extends FileRepositoryBase
  implements UserPreferencesRepository
{
  async save(preferences: UserPreferences): Promise<void> {
    await writeJsonFile(
      this.pathFor("user-preferences", preferences.userId),
      preferences,
    );
  }

  async getByUserId(userId: string): Promise<UserPreferences | null> {
    return readJsonFile<UserPreferences>(
      this.pathFor("user-preferences", userId),
    );
  }
}
