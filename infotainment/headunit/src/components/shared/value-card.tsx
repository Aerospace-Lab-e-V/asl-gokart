import { ValueCardProps } from "@/data/models";
import React from "react";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
  } from "@/components/ui/card"
  

const ValueCard = (props: ValueCardProps) => {
    return (
        <div>
            <Card>
                <CardHeader>
                    <CardTitle>
                        {props.value} {props.unit}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {props.label}
                </CardContent>
            </Card>
        </div>
    )}
export default ValueCard;