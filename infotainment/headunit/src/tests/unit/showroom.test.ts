const mockSend = jest.fn();
jest.mock("@/services/commands", () => ({ send: (...args: unknown[]) => mockSend(...args) }));

import { setLooping, useShowroom } from "@/stores/showroom";
import { useSession } from "@/stores/session";

const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
    jest.useFakeTimers();
    mockSend.mockResolvedValue({ ok: true });
    useSession.setState({ adminMode: true });
    useShowroom.setState({ looping: false, pauseS: 10, error: null });
});
afterEach(() => {
    setLooping(false);
    jest.useRealTimers();
});

test("plays at once, then again after the welcome plus the pause", async () => {
    setLooping(true);
    await flush();
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({ type: "lights.welcome" });

    jest.advanceTimersByTime(5000 + 10_000 - 1); // unknown animations count as 5 s
    await flush();
    expect(mockSend).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    await flush();
    expect(mockSend).toHaveBeenCalledTimes(2);
});

test("the first refusal stops the loop and says why", async () => {
    mockSend.mockResolvedValueOnce({ ok: false, error: "The welcome can only play while the kart stands still." });
    setLooping(true);
    await flush();
    expect(useShowroom.getState()).toMatchObject({ looping: false, error: expect.stringMatching(/stands still/) });
    jest.advanceTimersByTime(60_000);
    expect(mockSend).toHaveBeenCalledTimes(1);
});

test("locking admin mode stops the loop", async () => {
    setLooping(true);
    await flush();
    useSession.setState({ adminMode: false });
    expect(useShowroom.getState().looping).toBe(false);
    jest.advanceTimersByTime(60_000);
    await flush();
    expect(mockSend).toHaveBeenCalledTimes(1);
});
