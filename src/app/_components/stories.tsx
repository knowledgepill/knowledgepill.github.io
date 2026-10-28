import {Post} from "@/interfaces/post";
import {PostPreview} from "./post-preview";

type Props = {
  posts: Post[];
  showCoverImage?: boolean;
};

export function Stories({posts, showCoverImage = false}: Props) {
  return (
    <>
      {posts.map((post) => (
        <PostPreview
          key={post.slug}
          title={post.title}
          coverImage={post.coverImage}
          date={post.date}
          author={post.author}
          slug={post.slug}
          excerpt={post.excerpt}
          tags={post.tags}
          showCoverImage={showCoverImage}
          preview={post.preview}
        />
      ))}
    </>
  );
}
