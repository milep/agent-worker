import type { PiClient, PiTurnResponse } from "../core/runner.js";
import type { Message } from "../core/types.js";

const formatContent = (message: Message | undefined): unknown => {
  if (!message) {
    return "";
  }
  if (typeof message.content === "string") {
    return message.content;
  }
  return message.content ?? "";
};

export const createMockPiClient = (): PiClient => {
  return {
    runTurn: ({ messages, signal }): Promise<PiTurnResponse> => {
      if (signal.aborted) {
        return Promise.reject(new Error("run aborted"));
      }
      const lastUser = [...messages].reverse().find((msg) => msg.role === "user");
      const content = formatContent(lastUser);
      return Promise.resolve({
        assistant_message: {
          content,
          finish_reason: "stop"
        }
      });
    }
  };
};
