// A spec problem the agent can fix. The CLI prints these without a stack trace.
export class SpecError extends Error {
  constructor(message) {
    super(message);
    this.name = "SpecError";
  }
}
