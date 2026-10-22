import React from "react";
import { isPrerelease } from "@/lib/releases";

const { version, branch, builtAt, dev } = HEADUNIT_BUILD_INFO;

/** Version, branch and build time in the corner on pre-release and dev builds, so testers know what runs. */
export const BuildWatermark = () =>
    isPrerelease(version) || dev ? (
        <div
            className="text-foreground pointer-events-none fixed bottom-0 left-2 z-50 font-mono text-[10px] leading-3 opacity-40 select-none"
            aria-hidden
        >
            {version} · {branch} · built {builtAt.slice(0, 16).replace("T", " ")}Z
        </div>
    ) : null;
