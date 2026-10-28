import Container from "@/app/_components/container";

export function Footer() {
  return (
    <Container>
      <div className="py-28 flex flex-col lg:flex-row items-center">
        <h3 className="text-2xl lg:text-[1.5rem] font-bold tracking-tighter leading-tight text-center lg:text-left mb-10 lg:mb-0 lg:pr-4 lg:w-1/2">
          Software development, programming languages, and technology.
        </h3>
        <div className="flex flex-col lg:flex-row justify-center items-center lg:pl-4 lg:w-1/2">
          <a
            href="/posts/list"
            className="mx-3 bg-black hover:bg-white hover:text-black border border-black text-white font-bold py-3 px-12 lg:px-8 duration-200 transition-colors mb-6 lg:mb-0"
          >
            Posts list
          </a>
        </div>
      </div>
    </Container>
  );
}

export default Footer;
