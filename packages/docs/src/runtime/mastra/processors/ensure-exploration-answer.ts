import type {
  Processor,
  ProcessInputStepArgs,
  ProcessInputStepResult,
} from "@mastra/core/processors";

export class EnsureExplorationAnswerProcessor implements Processor {
  readonly id = "ensure-exploration-answer";

  constructor(private readonly maxSteps: number) {}

  async processInputStep({
    stepNumber,
    sendSignal,
  }: ProcessInputStepArgs): Promise<ProcessInputStepResult | undefined | void> {
    if (stepNumber !== this.maxSteps - 1) return;

    await sendSignal?.({
      type: "reactive",
      contents:
        `This is the final step (${stepNumber + 1} of ${this.maxSteps}). ` +
        "Do not call another tool. Answer the user now using only the evidence you inspected. " +
        "Include canonical source links from page frontmatter and state any unsupported parts.",
      attributes: {
        reason: "local-source-exploration-limit",
        step: stepNumber + 1,
      },
    });

    return { toolChoice: "none" };
  }
}
