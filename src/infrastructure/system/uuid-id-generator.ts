import { randomUUID } from 'node:crypto';
import type { IdGenerator } from '../../application/index.js';

export class UuidIdGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}
