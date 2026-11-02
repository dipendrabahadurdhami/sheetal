import React, { createContext, useContext } from "react";

// Which branch the workspace is showing. "all" = head office view.
// Staff limited to some branches only ever see those; owners and managers can switch freely.
const Ctx = createContext({ branch: "all", allowed: [], canAll: true, first: null });
export const BranchProvider = ({ value, children }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;
export const useBranch = () => useContext(Ctx);
export const inBranch = (branch, owner) => branch === "all" || !owner || owner === branch;
