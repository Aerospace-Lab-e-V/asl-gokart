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
import { useStore } from "@/stores/useStore";
import { useShallow } from "zustand/react/shallow";
import React from "react";

const ResetDailyDistanceDialog = () => {

    const { dailyDistance, setDailyDistance } = useStore(
        useShallow((state) => ({
            dailyDistance: state.dailyDistance,
            setDailyDistance: state.setDailyDistance,
        }))
    );

    return (
        <Dialog>
        <DialogTrigger>
          <Button variant="ghost">
            <p className="text-lg">{dailyDistance.toFixed(1)} km</p>
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
              <Button variant="destructive" onClick={() => setDailyDistance(0)}>
                <p>Reset</p>
              </Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    )
}

export default ResetDailyDistanceDialog