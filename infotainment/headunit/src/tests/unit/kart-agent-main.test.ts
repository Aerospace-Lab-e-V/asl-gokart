jest.mock("electron", () => ({ app: { getPath: () => require("os").tmpdir() }, ipcMain: { handle: jest.fn() } }));
jest.mock("electron-log/main", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("@/main/kart-agent-client", () => ({ getStatus: jest.fn(), getConfig: jest.fn(), putConfig: jest.fn() }));

import { getStatus } from "@/main/kart-agent-client";
import { pollAgent } from "@/main/kart-agent";

test("the last status is kept while the agent is unreachable", async () => {
    const status = { agent: { version: "1" } };
    (getStatus as jest.Mock).mockResolvedValueOnce(status).mockRejectedValueOnce(new Error("not reachable"));

    expect(await pollAgent()).toEqual({ status, error: null });
    expect(await pollAgent()).toEqual({ status, error: "not reachable" });
});
