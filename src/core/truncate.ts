export type TruncateResult = {
  text: string;
  truncated: boolean;
};

export const truncateText = (input: string, maxBytes: number): TruncateResult => {
  if (maxBytes <= 0) {
    return { text: "", truncated: input.length > 0 };
  }

  const buffer = Buffer.from(input, "utf8");
  if (buffer.byteLength <= maxBytes) {
    return { text: input, truncated: false };
  }

  const truncatedBuffer = buffer.subarray(0, maxBytes);
  return { text: truncatedBuffer.toString("utf8"), truncated: true };
};
