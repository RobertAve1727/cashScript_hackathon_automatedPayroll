import { Identifier, normaliseIdentifier } from './identifier.js';

export class PayrollRunId extends Identifier {
  private constructor(value: string) {
    super(value);
  }

  static of(raw: string): PayrollRunId {
    return new PayrollRunId(normaliseIdentifier('PayrollRunId', raw));
  }
}
