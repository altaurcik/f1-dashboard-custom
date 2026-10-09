"use client";
import { createContext, useContext } from "react";
import type { LiveContext } from "@/types/live-context.type";
export const ReferenceContext = createContext<LiveContext | null>(null);
export const useReferenceContext = () => useContext(ReferenceContext);
