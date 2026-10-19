import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Subpage } from "@/components/shared/subpage";
import { CodeInput } from "@/components/admin-mode/code-input";
import { CodeNumberpad } from "@/components/admin-mode/code-numberpad";
import { useStore } from "@/stores/useStore";

/** PIN entry for admin mode; returns to Settings as soon as the PIN is right. */
const AdminUnlockPage = () => {
    const navigate = useNavigate();
    const { adminMode, setAdminPin } = useStore(
        useShallow((state) => ({ adminMode: state.adminMode, setAdminPin: state.setAdminPin }))
    );

    // Start from an empty code, not one left over from an earlier attempt.
    useEffect(() => setAdminPin(""), [setAdminPin]);

    useEffect(() => {
        if (adminMode) navigate("/settings", { replace: true });
    }, [adminMode, navigate]);

    return (
        <Subpage title="Admin mode" backTo="/settings" className="justify-center">
            <div className="flex items-center justify-center gap-16">
                <div className="flex flex-col items-center gap-5">
                    <Lock className="text-muted-foreground h-12 w-12" aria-hidden />
                    <p className="text-xl">Enter the admin PIN</p>
                    <CodeInput />
                </div>
                <div className="w-96">
                    <CodeNumberpad />
                </div>
            </div>
        </Subpage>
    );
};

export default AdminUnlockPage;
