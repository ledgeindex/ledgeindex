import type {
  Processor,
  ProcessInputStepArgs,
  ProcessInputStepResult,
} from "@mastra/core/processors";

/**
 * On the last allowed step, inject a reactive <system-reminder> so the model
 * stops calling tools and emits a final text answer (needed before structuring).
 *
 * Pass the same maxSteps to this processor and to agent.generate({ maxSteps }).
 */
export class EnsureFinalResponseProcessor implements Processor {
  readonly id = "ensure-final-response";

  private maxSteps: number;

  constructor(maxSteps: number) {
    this.maxSteps = maxSteps;
  }

  async processInputStep({
    stepNumber,
    sendSignal,
  }: ProcessInputStepArgs): Promise<ProcessInputStepResult | undefined | void> {
    if (stepNumber !== this.maxSteps - 1) {
      return;
    }

    await sendSignal?.({
      type: "reactive",
      contents:
        `This is your final step (step ${stepNumber + 1} of ${this.maxSteps}). ` +
        `Do not call any more tools. Reply with exactly: done`,
      attributes: { reason: "max-steps-reached", step: stepNumber + 1 },
    });

    // Hard-stop tools even if the model ignores the reminder.
    return { toolChoice: "none" };
  }
}
