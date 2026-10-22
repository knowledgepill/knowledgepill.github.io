import {getAllPosts} from "@/lib/api";
import Link from "next/link";

export default async function Post() {

  const allPosts = getAllPosts();

  return (
    <main>
      <ul>
        {allPosts.map((post) => (<li key={post.slug}>
          <Link href={post.slug}>{post.date}-{post.title}</Link>
        </li>))}
      </ul>
    </main>
  );
}