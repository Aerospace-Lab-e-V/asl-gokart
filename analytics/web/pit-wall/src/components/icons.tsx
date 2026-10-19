import type { ReactNode } from "react";

function Icon({ children }: { children: ReactNode }) {
    return (
        <svg
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {children}
        </svg>
    );
}

export const OverviewIcon = () => (
    <Icon>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
    </Icon>
);

export const BatteryIcon = () => (
    <Icon>
        <rect x="2" y="7" width="17" height="10" rx="2" />
        <path d="M22 11v2" />
        <path d="M6 10v4M10 10v4" />
    </Icon>
);

export const GaugeIcon = () => (
    <Icon>
        <path d="M4 18a9 9 0 1 1 16 0" />
        <path d="M12 14l4-5" />
    </Icon>
);

export const ThermometerIcon = () => (
    <Icon>
        <path d="M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0z" />
    </Icon>
);

export const TrackIcon = () => (
    <Icon>
        <path d="M12 21s-6-5.5-6-11a6 6 0 1 1 12 0c0 5.5-6 11-6 11z" />
        <circle cx="12" cy="10" r="2" />
    </Icon>
);

export const SunIcon = () => (
    <Icon>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Icon>
);

export const MoonIcon = () => (
    <Icon>
        <path d="M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10z" />
    </Icon>
);
