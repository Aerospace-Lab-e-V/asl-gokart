import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { agent } from "@/services/agent";
import { Enrollment } from "@/services/kart-agent/schema";
import log from "@/lib/logger";

/*
 * Enrollment (analytics ADR-0004): the kart asks the analytics server for a certificate and a
 * broker login, shows the code it gets back, and an admin approves that code on the server
 * (`kart-enroll approve <CODE>`). Starting and cancelling need admin mode.
 */

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Opens the request dialog; the kart ID defaults to the configured one. */
export const EnrollDialog = ({ trigger }: { trigger: React.ReactNode }) => {
    const [open, setOpen] = useState(false);
    const [kartId, setKartId] = useState("");
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!open) return;
        agent
            .getConfig()
            .then((reply) => setKartId(reply.effective.kart_id))
            .catch((e) => log.error(e));
    }, [open]);

    const request = async () => {
        setBusy(true);
        try {
            await agent.enroll(kartId.trim() || undefined);
            setOpen(false);
        } catch (e) {
            toast.error(`Enrollment not started: ${message(e)}`);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
            <DialogTrigger asChild>{trigger}</DialogTrigger>
            <DialogContent className="max-w-xl gap-6">
                <DialogHeader>
                    <DialogTitle className="text-xl">Enroll this kart</DialogTitle>
                    <DialogDescription className="text-lg">
                        The kart asks the analytics server for its certificate. An admin then
                        approves the code shown here. Only works on the lab network.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-2">
                    <Label htmlFor="enroll-kart-id" className="text-base">
                        Kart id
                    </Label>
                    <Input
                        id="enroll-kart-id"
                        className="h-12 text-lg"
                        value={kartId}
                        onChange={(e) => setKartId(e.target.value)}
                    />
                </div>
                <div className="flex justify-end gap-3">
                    <Button
                        variant="outline"
                        className="h-12 px-6 text-base"
                        disabled={busy}
                        onClick={() => setOpen(false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        className="h-12 px-6 text-base"
                        disabled={busy || !kartId.trim()}
                        onClick={request}
                    >
                        {busy && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                        Request
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

const useNowS = () => {
    const [now, setNow] = useState(() => Date.now() / 1000);
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now() / 1000), 1000);
        return () => clearInterval(t);
    }, []);
    return now;
};

/** The code an admin approves, large enough to read from beside the kart. */
export const PendingCode = ({ enrollment, admin }: { enrollment: Enrollment; admin: boolean }) => {
    const now = useNowS();
    const [busy, setBusy] = useState(false);
    if (enrollment.state !== "pending" || !enrollment.code) return null;
    const left = Math.max(0, Math.round((enrollment.expires_at_s ?? now) - now));

    const cancel = async () => {
        setBusy(true);
        try {
            await agent.cancelEnroll();
        } catch (e) {
            toast.error(`Not cancelled: ${message(e)}`);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="flex items-center gap-8 pb-5 pl-12">
            <div className="flex flex-col gap-1">
                <span className="text-muted-foreground text-lg">
                    Approval code for {enrollment.requested_id ?? "this kart"}
                </span>
                <span className="font-mono text-5xl font-semibold tracking-widest">
                    {enrollment.code}
                </span>
                <span className="text-muted-foreground text-lg">
                    On the server: kart-enroll approve {enrollment.code} · {Math.floor(left / 60)}:
                    {String(left % 60).padStart(2, "0")} left
                </span>
            </div>
            {admin && (
                <Button
                    variant="outline"
                    className="ml-auto h-12 px-6 text-base"
                    disabled={busy}
                    onClick={cancel}
                >
                    Cancel
                </Button>
            )}
        </div>
    );
};
