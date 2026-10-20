import "@testing-library/jest-dom";
import { TextDecoder, TextEncoder } from "util";

// jsdom lacks these; react-router needs them.
Object.assign(globalThis, { TextEncoder, TextDecoder });
