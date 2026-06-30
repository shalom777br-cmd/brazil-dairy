import { BlogPost } from "../types";
import { postsPart1 } from "./posts_part1";
import { postsPart2 } from "./posts_part2";
import { postsPart3 } from "./posts_part3";
import { postsPart4 } from "./posts_part4";
import { postsPart5 } from "./posts_part5";

export const importedPosts: BlogPost[] = [
  ...postsPart1,
  ...postsPart2,
  ...postsPart3,
  ...postsPart4,
  ...postsPart5
];
