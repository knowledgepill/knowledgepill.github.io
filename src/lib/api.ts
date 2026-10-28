import {Post} from "@/interfaces/post";
import fs from "fs";
import matter from "gray-matter";
import {join} from "path";

const postsDirectory = join(process.cwd(), "_posts");

export const getPostSlugs =
  () => fs.readdirSync(postsDirectory, {recursive: true})
    .map((slug) => slug.toString());

export const getPostBySlug = (slug: string): Post | null => {
  try {
    const realSlug = slug.replace(/\.md$/, "");
    const fullPath = join(postsDirectory, `${realSlug}.md`);
    const fileContents = fs.readFileSync(fullPath, "utf8");
    const {data, content} = matter(fileContents);
    return {...data, slug: realSlug, content} as Post;
  } catch (err) {
    return null;
  }
}

export const postSortDesc = (post1: Post, post2: Post) => {

  if (!post1.preview && !post2.preview) {
    return post1.date > post2.date ? -1 : 1
  }

  if (!post1.preview && post2.preview) {
    return -1;
  }

  if (post1.preview && !post2.preview) {
    return 1;
  }

  return post1.date > post2.date ? -1 : 1
};

export const getAllPosts =
  (soringCompareFn: (p1: Post, p2: Post) => number = postSortDesc): Post[] => {
    const posts = getPostSlugs()
      .map((slug) => getPostBySlug(slug))
      .filter((post) => post !== null)
      .sort(soringCompareFn);

    console.log(posts.map((post) => {
      return {
        ...post,
        "content": post.content.length
      };
    }));

    return posts;
  };
