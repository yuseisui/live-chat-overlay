export function assertNever(type: never): never {
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    throw new Error(`Unknown object: ${type}`);
}

// Reference from Youtube livechat.js
export function colorFromDecimal(decimal: number): string {
    return `rgba(${[
        // eslint-disable-next-line no-bitwise
        (decimal >> 16) & 255,
        // eslint-disable-next-line no-bitwise
        (decimal >> 8) & 255,
        // eslint-disable-next-line no-bitwise
        decimal & 255,
        // eslint-disable-next-line no-bitwise
        ((decimal >> 24) & 255) / 255,
    ].join(',')})`;
}

export function isNonNullable<T>(value: T): value is NonNullable<T> {
    return !!value;
}