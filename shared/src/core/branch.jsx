// The branch the panel is showing ("all" or one branch name), shared with every page through React context.
// Where it fits: BusinessApp provides it; pages read it with useBranch().
// How it works: owners and "all branches" people can pick any branch or all; others only theirs.

import React, { createContext, useContext } from "react";

const Ctx = createContext({ branch: "all", allowed: [], canAll: true, first: null });
export const BranchProvider = ({ value, children }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;
export const useBranch = () => useContext(Ctx);
export const inBranch = (branch, owner) => branch === "all" || !owner || owner === branch;
