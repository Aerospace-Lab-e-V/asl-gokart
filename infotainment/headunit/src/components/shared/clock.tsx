import React from "react";
import { useEffect, useState } from "react";

const DigitalClock = () => {
  const [time, setTime] = useState<string>("00:00");

  const updateTime = () => {
    const currentDate = new Date();
    setTime(
      currentDate.toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
        second: undefined,
      }));
  };

  useEffect(() => {
    updateTime();
    // Update the time every second
    const intervalId = setInterval(() => {
      updateTime();
    }, 1000);

    // Clean up the interval when the component is unmounted
    return () => clearInterval(intervalId);
  }, []); // Empty dependency array ensures the effect runs only once on mount

  return <p className="text-2xl font-semibold tabular-nums">{time}</p>;
};

export default DigitalClock;
