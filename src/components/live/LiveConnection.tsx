"use client";
import { createContext, useContext } from "react";
export const LiveConnectionContext = createContext(false);
export const useLiveConnection = () => useContext(LiveConnectionContext);
