import PrettyError from "pretty-error";
import chalk from "chalk";

chalk.level = 3;

const prettyError = new PrettyError();

prettyError.appendStyle({
  "pretty-error > header > title > kind": {
    background: "red",
    color: "white",
  },
  "pretty-error > header > colon": { color: "white" },
  "pretty-error > header > message": { color: "red" },
  "pretty-error > trace > item > header > pointer > file": { color: "cyan" },
  "pretty-error > trace > item > header > pointer > line": { color: "yellow" },
});

const isDev = process.env.NODE_ENV !== "production";

export const logInfo = (message: string, context?: string, data?: unknown) => {
  const timestamp = new Date().toISOString();

  if (!isDev) {
    const logEntry: Record<string, unknown> = {
      severity: "INFO",
      message,
      timestamp,
    };
    if (context) logEntry.context = context;
    if (data) logEntry.data = data;

    console.info(JSON.stringify(logEntry));
    return;
  }

  const emoji = "📌";

  if (context) {
    console.info(
      chalk.blue(`${emoji} INFO`) +
        chalk.gray(` [${timestamp}]`) +
        chalk.cyan(` [${context}]`) +
        chalk.white(`: ${message}`),
    );
  } else {
    console.info(
      chalk.blue(`${emoji} INFO`) +
        chalk.gray(` [${timestamp}]`) +
        chalk.white(`: ${message}`),
    );
  }

  if (data !== undefined) {
    if (typeof data === "object" && data !== null) {
      console.info(chalk.gray("   Variables:"));
      Object.entries(data).forEach(([key, value]) => {
        console.info(
          chalk.gray("     ") +
            chalk.cyan(key) +
            chalk.gray(": ") +
            chalk.dim(typeof value === "string" ? `"${value}"` : String(value)),
        );
      });
    } else {
      console.info(chalk.gray("   Data:"), chalk.dim(String(data)));
    }
  }

  console.info("");
};

export const logWarn = (message: string, context?: string, data?: unknown) => {
  const timestamp = new Date().toISOString();

  if (!isDev) {
    const logEntry: Record<string, unknown> = {
      severity: "WARNING",
      message,
      timestamp,
    };
    if (context) logEntry.context = context;
    if (data) logEntry.data = data;
    console.warn(JSON.stringify(logEntry));
    return;
  }

  const emoji = "⚠️";

  if (context) {
    console.warn(
      chalk.yellow(`${emoji} WARN`) +
        chalk.gray(` [${timestamp}]`) +
        chalk.yellowBright(` [${context}]`) +
        chalk.white(`: ${message}`),
    );
  } else {
    console.warn(
      chalk.yellow(`${emoji} WARN`) +
        chalk.gray(` [${timestamp}]`) +
        chalk.white(`: ${message}`),
    );
  }

  if (data !== undefined) {
    if (typeof data === "object" && data !== null) {
      console.warn(chalk.gray("   Variables:"));
      Object.entries(data).forEach(([key, value]) => {
        console.warn(
          chalk.gray("     ") +
            chalk.yellow(key) +
            chalk.gray(": ") +
            chalk.dim(typeof value === "string" ? `"${value}"` : String(value)),
        );
      });
    } else {
      console.warn(chalk.gray("   Data:"), chalk.dim(String(data)));
    }
  }

  console.warn("");
};

export const logVerbose = (
  message: string,
  context?: string,
  data?: unknown,
) => {
  if (!isDev) return;

  const emoji = "🔍";
  const timestamp = new Date().toISOString();

  if (context) {
    console.log(
      chalk.yellow(`${emoji} VERBOSE`) +
        chalk.gray(` [${timestamp}]`) +
        chalk.yellowBright(` [${context}]`) +
        chalk.white(`: ${message}`),
    );
  } else {
    console.log(
      chalk.yellow(`${emoji} VERBOSE`) +
        chalk.gray(` [${timestamp}]`) +
        chalk.white(`: ${message}`),
    );
  }

  if (data !== undefined) {
    if (typeof data === "object" && data !== null) {
      console.log(chalk.gray("   Data:"));
      if (Array.isArray(data)) {
        data.forEach((item, index) => {
          console.log(
            chalk.gray("     ") +
              chalk.yellow(`[${index}]`) +
              chalk.gray(": ") +
              chalk.dim(
                typeof item === "string" ? `"${item}"` : JSON.stringify(item),
              ),
          );
        });
      } else {
        Object.entries(data).forEach(([key, value]) => {
          console.log(
            chalk.gray("     ") +
              chalk.yellow(key) +
              chalk.gray(": ") +
              chalk.dim(
                typeof value === "string" ? `"${value}"` : JSON.stringify(value),
              ),
          );
        });
      }
    } else {
      console.log(chalk.gray("   Data:"), chalk.dim(String(data)));
    }
  }

  console.log("");
};

export const logError = (
  error: Error | string,
  context?: string,
  data?: unknown,
) => {
  if (typeof error === "string") {
    error = new Error(error);
  }

  const timestamp = new Date().toISOString();

  if (!isDev) {
    const logEntry: Record<string, unknown> = {
      severity: "ERROR",
      message: error.message,
      stack: error.stack,
      timestamp,
    };
    if (context) logEntry.context = context;
    if (data) logEntry.data = data;

    console.error(JSON.stringify(logEntry));
    return;
  }

  const emoji = "🚨";

  if (context) {
    console.error(
      chalk.red(`${emoji} ERROR`) +
        chalk.gray(` [${timestamp}]`) +
        chalk.redBright(` [${context}]`),
    );
  } else {
    console.error(
      chalk.red(`${emoji} ERROR`) + chalk.gray(` [${timestamp}]`),
    );
  }

  console.error(prettyError.render(error));

  if (data !== undefined) {
    if (typeof data === "object" && data !== null) {
      console.error(chalk.gray("   Additional Data:"));
      Object.entries(data).forEach(([key, value]) => {
        console.error(
          chalk.gray("     ") +
            chalk.red(key) +
            chalk.gray(": ") +
            chalk.dim(typeof value === "string" ? `"${value}"` : String(value)),
        );
      });
    } else {
      console.error(chalk.gray("   Data:"), chalk.dim(String(data)));
    }
  }

  console.error("");
};
