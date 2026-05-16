import {
  BadgesLeafInfo,
  BadgesMainnetLeafInfo,
  BadgesMainnetMerkleTreeData,
  BadgesMerkleTreeData,
  DripLeafInfo,
  DripMerkleTreeData,
} from "@/lib/types";
import { MerkleTree } from "merkletreejs";
import { encodePacked, getAddress, keccak256, parseEther } from "viem";

// New function to calculate merkle data for each badge ID (ERC1155)
export const calculateMerkleDataForEachBadge = (
  claimAmounts: {
    address: string;
    amounts: number[];
    ids: number[];
  }[],
): Record<number, BadgesMerkleTreeData> => {
  const badgeIdToClaims: Record<number, { address: string; amount: number }[]> =
    {};

  claimAmounts.forEach(({ address, amounts, ids }) => {
    ids.forEach((id, index) => {
      if (!badgeIdToClaims[id]) {
        badgeIdToClaims[id] = [];
      }
      badgeIdToClaims[id].push({ address, amount: amounts[index] });
    });
  });

  const badgeIdToMerkleData: Record<number, BadgesMerkleTreeData> = {};

  Object.entries(badgeIdToClaims).forEach(([badgeId, claims]) => {
    const leaves: Buffer[] = [];
    const leafToData: BadgesLeafInfo = {};

    claims.forEach(({ address, amount }, index) => {
      const leafInput = keccak256(
        encodePacked(
          ["uint256", "address", "uint256", "uint256"],
          [BigInt(index), getAddress(address), BigInt(badgeId), BigInt(amount)],
        ),
      );

      const leaf = Buffer.from(leafInput.slice(2), "hex");
      leaves.push(leaf);
      leafToData[leaf.toString("hex")] = {
        index,
        amount,
        id: parseInt(badgeId),
      };
    });

    console.log("Number of leaves:", leaves.length);

    const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
    const root = tree.getHexRoot();

    const merkleData: BadgesMerkleTreeData = {
      root,
      data: {},
    };

    claims.forEach(({ address }, index) => {
      const leaf = leaves[index];
      const proof = tree.getHexProof(leaf);
      const leafData = leafToData[leaf.toString("hex")];

      merkleData.data[address] = {
        index: leafData.index,
        amount: leafData.amount,
        id: leafData.id,
        proof,
      };
    });

    badgeIdToMerkleData[parseInt(badgeId)] = merkleData;
  });

  return badgeIdToMerkleData;
};

// Add this new function
export const calculateMerkleDataForAllBadges = (
  claimAmounts: {
    address: string;
    ids: number[];
  }[],
): BadgesMainnetMerkleTreeData => {
  const leaves: Buffer[] = [];
  const leafToData: BadgesMainnetLeafInfo = {};

  claimAmounts.forEach(({ address, ids }, index) => {
    const leafInput = keccak256(
      encodePacked(
        ["uint256", "address", "uint256[]"],
        [BigInt(index), getAddress(address), ids.map(BigInt)],
      ),
    );

    const leaf = Buffer.from(leafInput.slice(2), "hex");
    leaves.push(leaf);
    leafToData[leaf.toString("hex")] = {
      index,
      ids,
    };
  });

  console.log("Number of leaves:", leaves.length);

  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const root = tree.getHexRoot();

  const merkleData: BadgesMainnetMerkleTreeData = {
    root,
    data: {},
  };

  claimAmounts.forEach(({ address }, index) => {
    const leaf = leaves[index];
    const proof = tree.getHexProof(leaf);
    const leafData = leafToData[leaf.toString("hex")];

    merkleData.data[address] = {
      index: leafData.index,
      ids: leafData.ids,
      proof,
    };
  });

  return merkleData;
};
