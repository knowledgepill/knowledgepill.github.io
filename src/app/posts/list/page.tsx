import {getAllPosts} from "@/lib/api";
import Link from "next/link";
import DateFormatter from "@/app/_components/date-formatter";
import {Post} from "@/interfaces/post";
import {TagsList} from "@/app/_components/tags-list";

export default async function PostsList() {

  const allPosts = getAllPosts();
  const published = allPosts.filter((p) => p.preview !== true);
  const preview = allPosts.filter((p) => p.preview === true);

  const PostsList = (props: { allPosts: Post[] }) => (
    <ul>
      {props.allPosts
        .filter((p) => p.date)
        .map((p) => (
          <li key={p.slug} className="mb-2">
            <Link href={p.slug} className="flex items-center gap-6">
              <div className="inline-block text-gray-500">
                <DateFormatter dateString={p.date}/>
              </div>
              <div>
                {p.title}
              </div>
              <div>
                <TagsList tags={p.tags}/>
              </div>
            </Link>
          </li>
        ))}
    </ul>
  );

  return (
    <>
      <div className="mb-8">
        <h2>Published Posts {published.length}</h2>
        <PostsList allPosts={published}/>
      </div>

      <div>
        <h2>Preview Posts {preview.length}</h2>
        <PostsList allPosts={preview}/>
      </div>
    </>
  );
}