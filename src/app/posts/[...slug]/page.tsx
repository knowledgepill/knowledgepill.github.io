import {Metadata} from "next";
import {notFound} from "next/navigation";
import {getAllPosts, getPostBySlug} from "@/lib/api";
import markdownToHtml from "@/lib/markdownToHtml";
import {PostBody} from "@/app/_components/post-body";
import {PostHeader} from "@/app/_components/post-header";
import PreviewAlert from "@/app/_components/preview-alert";

type Params = {
  params: Promise<{
    slug: string[];
  }>;
};

export default async function Post(props: Params) {
  const params = await props.params;
  const post = getPostBySlug(params.slug.join("/"));

  if (!post) {
    return notFound();
  }

  const content = await markdownToHtml(post.content || "");

  return (
    <>
      <PreviewAlert preview={post.preview} />
      <PostHeader
        title={post.title}
        coverImage={post.coverImage}
        date={post.date}
        author={post.author}
      />
      <PostBody content={content}/>
    </>
  );
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const params = await props.params;
  const post = getPostBySlug(params.slug.join("/"));

  if (!post) {
    return notFound();
  }

  const title = `${post.title} | Knowledge Pill`;

  return {
    title,
    openGraph: {
      title,
      images: [post.ogImage?.url],
    },
  };
}

export async function generateStaticParams() {
  const posts = getAllPosts();

  return posts
    .map((post) => ({
    slug: [...post.slug.split("/")],
  }));
}
