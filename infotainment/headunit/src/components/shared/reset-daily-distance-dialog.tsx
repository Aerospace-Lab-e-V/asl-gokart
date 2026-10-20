import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose
} from "@/components/ui/dialog"
import React from "react";
import { fmt } from "@/components/drive/format";

interface ResetDailyDistanceDialogProps {
    /** km; null shows "--". */
    dailyDistance: number | null;
    onReset: () => void;
}

/** Not mounted. TODO(firmware): no ECU publishes trip distance; feed it from a signal and a reset command when one does. */
const ResetDailyDistanceDialog = ({ dailyDistance, onReset }: ResetDailyDistanceDialogProps) => {

    return (
        <Dialog>
        <DialogTrigger>
          <Button variant="ghost">
            <p className="text-lg">{fmt(dailyDistance, 1)} km</p>
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Daily Distance</DialogTitle>
            <DialogDescription>Reset daily drive statistics?</DialogDescription>
          </DialogHeader>
          <div className="flex flex-row items-center justify-center gap-x-4">
            <DialogClose>
              <Button variant="outline">
                <p>Cancel</p>
              </Button>
            </DialogClose>
            <DialogClose>
              <Button variant="destructive" onClick={onReset}>
                <p>Reset</p>
              </Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    )
}

export default ResetDailyDistanceDialog