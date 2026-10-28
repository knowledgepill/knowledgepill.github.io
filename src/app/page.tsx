import Container from "@/app/_components/container";
import {Intro} from "@/app/_components/intro";
import {Stories} from "@/app/_components/stories";
import {getAllPosts} from "@/lib/api";
import {dedup} from "@/lib/arrays";

export default function Index() {
  const allPosts = getAllPosts()
    .filter((post) => !post.preview);

  return allPosts && (
    <Container>

      <Intro/>

      <section className="flex flex-row ">
        <div>
          <div className="grid grid-cols-1 md:grid-cols-3 md:gap-x-16 lg:gap-x-32 gap-y-20 md:gap-y-32 mb-32">
            {allPosts.length > 0 && <Stories posts={allPosts.slice(0, 2)} showCoverImage={true}/>}
          </div>
        </div>
        <div>
          {
            allPosts.length > 0 && dedup(allPosts
              .flatMap((post) => post.tags))
              .filter((tag) => !!tag && tag.trim().length > 0)
              .map((tag) =>
                <span key={tag}
                      className="inline-block bg-gray-50 px-3 py-1 text-xs font-light text-gray-700 mr-2 mb-2">
                  {tag}
                </span>
              )
          }
          {
            allPosts.length > 0 && allPosts.findIndex((post) => post.preview) > -1 && (
              <span key="preview-tag"
                    className="inline-block bg-black px-3 py-1 text-xs font-light text-white mr-2 mb-2">
                  Preview
              </span>
            )
          }
        </div>
      </section>

      <section>
        <div className="grid grid-cols-1 md:grid-cols-3 md:gap-x-16 lg:gap-x-32 gap-y-20 md:gap-y-32 mb-32">
          {allPosts.length > 0 && <Stories posts={allPosts.slice(2)}/>}
        </div>
      </section>

    </Container>
  );
}
