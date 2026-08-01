import { Identifier, normaliseIdentifier } from './identifier.js';

export class EmployeeId extends Identifier {
  private constructor(value: string) {
    super(value);
  }

  static of(raw: string): EmployeeId {
    return new EmployeeId(normaliseIdentifier('EmployeeId', raw));
  }
}
