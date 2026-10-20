import { useCallback, useState } from "react";
import type { Command, CommandResult } from "@/domain/commands";
import { useSent } from "@/stores/sent";

/** Sends a command to the ECU that owns it. State changes only when the ECU echoes it. */
export async function send(command: Command): Promise<CommandResult> {
    let result: CommandResult;
    try {
        result = await window.api.command(command);
    } catch (err) {
        result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (result.ok) useSent.setState({ [command.type]: command });
    return result;
}

/** `pending` while the command is in flight, `error` from the last failure. Pending lives in the caller. */
export function useCommand() {
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const run = useCallback(async (command: Command) => {
        setPending(true);
        const result = await send(command);
        setPending(false);
        setError(result.ok ? null : result.error);
        return result;
    }, []);
    return { run, pending, error };
}
