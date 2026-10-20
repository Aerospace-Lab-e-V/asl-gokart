import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { Subpage } from "@/components/shared/subpage";
import { CodeInput } from "@/components/admin-mode/code-input";
import { CodeNumberpad } from "@/components/admin-mode/code-numberpad";
import { useSession } from "@/stores/session";
import { admin } from "@/services/admin";
import log from "@/lib/logger";

/** PIN entry for admin mode; returns to Settings as soon as main reports admin mode. */
const AdminUnlockPage = () => {
    const navigate = useNavigate();
    const adminMode = useSession((state) => state.adminMode);
    // Starts empty on every visit, not with a code left over from an earlier attempt.
    const [pin, setPin] = useState("");

    useEffect(() => {
        if (adminMode) navigate("/settings", { replace: true });
    }, [adminMode, navigate]);

    // Main checks the PIN and pushes the new admin state on success.
    const unlock = async (code: string) => {
        try {
            if (await admin.unlock(code)) {
                toast("Admin mode enabled!");
                return;
            }
            log.error("Wrong PIN!");
            toast.error("Wrong PIN!");
        } catch (e) {
            log.error(e);
            toast.error(`Could not unlock: ${e instanceof Error ? e.message : e}`);
        }
        // Clear the code so the next attempt can be typed right away.
        setPin("");
    };

    return (
        <Subpage title="Admin mode" backTo="/settings" className="justify-center">
            <div className="flex items-center justify-center gap-16">
                <div className="flex flex-col items-center gap-5">
                    <Lock className="text-muted-foreground h-12 w-12" aria-hidden />
                    <p className="text-xl">Enter the admin PIN</p>
                    <CodeInput value={pin} onComplete={unlock} />
                </div>
                <div className="w-96">
                    <CodeNumberpad value={pin} onChange={setPin} />
                </div>
            </div>
        </Subpage>
    );
};

export default AdminUnlockPage;
