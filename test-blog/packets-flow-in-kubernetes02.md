<!-- # Inside CoreDNS: How Kubernetes Answers Millions of DNS Queries (Part 1)

## From a Simple DNS Query to One of Kubernetes' Most Important Components

> *"Every application in Kubernetes depends on DNS, yet most engineers never look inside the DNS server that's answering their queries."*

In the previous article, we followed a single packet from our frontend Pod to the backend Pod.

Our journey looked something like this:

```text
Frontend Pod
      │
curl http://backend.backend
      │
      ▼
Linux Resolver
      │
      ▼
/etc/resolv.conf
      │
      ▼
kube-dns Service
      │
      ▼
CoreDNS
      │
      ▼
Returns ClusterIP
      │
      ▼
kube-proxy
      │
      ▼
Backend Pod
```

Most Kubernetes engineers stop here.

> "CoreDNS resolves the name."

But that's like saying:

> "Google finds webpages."

It tells you **what** happened, but not **how**.

CoreDNS is one of the busiest applications running inside your cluster.

Every application that connects to another Service...

Every application that talks to a database...

Every controller that communicates with the Kubernetes API...

Every Pod that accesses an external website...

Eventually sends a DNS query to CoreDNS.

On a busy production cluster, CoreDNS can answer **hundreds of thousands or even millions of DNS requests every day**.

So naturally, a few questions arise.

* How does CoreDNS know every Service in the cluster?
* Does it query the Kubernetes API Server every single time?
* How does it resolve `backend.backend` differently from `google.com`?
* Why is there a Service named `kube-dns` even though the Pods are called CoreDNS?
* What happens when CoreDNS goes down?
* What do all those mysterious plugins in the ConfigMap actually do?

By the end of this article, CoreDNS won't be a black box anymore.

You'll understand exactly how it works, why it's so fast, and how to troubleshoot it when things go wrong.

---

# Meet CoreDNS

Let's start by finding it.

```bash
kubectl get pods -n kube-system
```

You'll probably see something similar to:

```text
NAME                        READY   STATUS
coredns-6f6b679f8f-6qk2x    1/1     Running
coredns-6f6b679f8f-v2cz7    1/1     Running
```

Immediately, one thing stands out.

There are usually **two** CoreDNS Pods.

Why?

High availability.

Imagine if your cluster only had one DNS server.

If that Pod crashed, every new DNS lookup in your cluster would fail.

Applications wouldn't be able to discover Services.

Controllers might fail to contact the API Server.

New workloads could behave unpredictably.

Running multiple replicas ensures DNS continues working even if one Pod disappears.

Of course, the Pods themselves don't have stable IP addresses.

Just like every other Kubernetes workload, they can be recreated at any time.

So how do Pods consistently find them?

The answer should sound familiar.

Through a Service.

---

# The `kube-dns` Service

List the Services in the `kube-system` namespace.

```bash
kubectl get svc -n kube-system
```

Example:

```text
NAME       TYPE        CLUSTER-IP
kube-dns   ClusterIP   10.96.0.10
```

Wait a minute.

The Pods are called:

```text
coredns
```

But the Service is called:

```text
kube-dns
```

That seems inconsistent.

It's actually a piece of Kubernetes history.

---

# A Brief History Lesson

Before CoreDNS existed, Kubernetes used another DNS server called **kube-dns**.

The architecture looked something like this:

```text
Pods

      │

      ▼

kube-dns Service

      │

      ▼

kube-dns Pods
```

Later, the Kubernetes community decided to replace kube-dns with CoreDNS.

CoreDNS was:

* simpler
* faster
* easier to extend
* plugin-based
* actively maintained

Replacing the Pods was easy.

Changing the Service name wasn't.

Imagine thousands of clusters with applications already configured to use:

```text
10.96.0.10
```

or expecting a Service named:

```text
kube-dns
```

Changing the Service name would have broken backward compatibility.

Instead, Kubernetes kept the Service exactly the same and simply changed what was behind it.

Today, the architecture looks like this.

```text
             kube-system Namespace

       ┌─────────────────────────────┐

              kube-dns Service

               10.96.0.10

                     │

          ┌──────────┴──────────┐

          │                     │

          ▼                     ▼

     CoreDNS Pod          CoreDNS Pod

       │                     │

       └──────────┬───────────┘

                  ▼

          Answers DNS Queries

       └─────────────────────────────┘
```

From the perspective of every application in your cluster, nothing changed.

Pods still send DNS requests to:

```text
10.96.0.10
```

The Service simply forwards those requests to whichever CoreDNS Pod is available.

This is exactly the same pattern you use when exposing your own applications.

---

# Let's Prove It

Describe the Service.

```bash
kubectl describe svc kube-dns -n kube-system
```

Near the bottom you'll find something similar to:

```text
Endpoints:

10.244.0.8:53

10.244.1.15:53
```

Those endpoint addresses belong to the CoreDNS Pods.

If one Pod dies, Kubernetes automatically removes it from the endpoint list.

Traffic continues flowing to the remaining healthy Pod.

Applications never notice.

---

# Before We Continue...

Let's take a small detour.

To appreciate how CoreDNS works, we first need to understand what a DNS server actually does.

Forget Kubernetes for a moment.

Suppose you're sitting on your laptop.

You type:

```text
google.com
```

into your browser.

Your browser doesn't know Google's IP address.

Instead, it asks the operating system.

The operating system asks a DNS server.

The DNS server replies:

```text
google.com

↓

142.250.x.x
```

Now your browser can finally establish a TCP connection.

Without DNS, you'd have to remember IP addresses for every website you visit.

Fortunately, humans are much better at remembering names than numbers.

The exact same principle applies inside Kubernetes.

Instead of remembering:

```text
10.96.18.72
```

your application simply remembers:

```text
backend.backend
```

CoreDNS performs the translation.

---

# DNS Records You Should Know

CoreDNS returns several types of DNS records, but you'll encounter a handful most often.

## A Records

The most common record.

Maps a hostname to an IPv4 address.

Example:

```text
backend.backend.svc.cluster.local

↓

10.96.18.72
```

Whenever your application connects to a Service, this is usually the record being returned.

---

## AAAA Records

Exactly the same idea, but for IPv6.

Example:

```text
backend.backend.svc.cluster.local

↓

fd00::1234
```

If your cluster supports IPv6 or dual-stack networking, you'll see these records too.

---

## SRV Records

Unlike an A record, which returns only an IP address, an SRV record also includes port information.

They're particularly useful for discovering services that expose multiple named ports.

For example:

```text
_http._tcp.backend.backend.svc.cluster.local
```

might return both the hostname and the port clients should connect to.

Many distributed systems and service meshes rely on SRV records for service discovery.

---

## PTR Records

PTR records perform the opposite lookup.

Instead of asking:

> "What IP belongs to this name?"

they answer:

> "What name belongs to this IP?"

They're commonly used for reverse DNS lookups and debugging.

---

# So What Makes Kubernetes DNS Different?

A traditional DNS server usually stores records in zone files or receives them from an upstream authority.

CoreDNS running inside Kubernetes doesn't.

Nobody manually creates DNS entries for every Service.

Imagine doing that in a production cluster.

Every Deployment scaling event...

Every rolling update...

Every Pod restart...

Every new namespace...

would require manually editing DNS records.

That would be impossible.

Instead, CoreDNS builds its DNS database automatically from Kubernetes itself.

It continuously learns about:

* Services
* Pods
* Namespaces
* EndpointSlices

without anyone editing configuration files.

The obvious question now is:

> **How does it keep that information up to date without constantly asking the Kubernetes API Server?**

That question takes us to one of the most elegant parts of Kubernetes' architecture: **informers, watches, and CoreDNS's in-memory cache**.

We'll open that black box in the next part, where we'll also begin dissecting the famous CoreDNS ConfigMap—line by line, plugin by plugin—to understand why such a small configuration powers DNS for some of the largest Kubernetes clusters in the world.

# Inside CoreDNS: How Kubernetes Answers Millions of DNS Queries (Part 2)

## The CoreDNS ConfigMap — Understanding Every Line

In Part 1, we learned that every DNS request inside the cluster eventually reaches one of the CoreDNS Pods.

But here's something surprising.

The entire behavior of CoreDNS is controlled by a single ConfigMap.

Let's take a look.

---

# Finding the Configuration

Run:

```bash
kubectl get configmap -n kube-system
```

You'll see something similar to:

```text
NAME
coredns
kube-root-ca.crt
```

Let's inspect it.

```bash
kubectl edit configmap coredns -n kube-system
```

or

```bash
kubectl get configmap coredns \
-n kube-system \
-o yaml
```

Depending on your Kubernetes distribution, the configuration may vary slightly, but a default installation usually looks similar to this:

```text
.:53 {
    errors
    health {
        lameduck 5s
    }

    ready

    kubernetes cluster.local in-addr.arpa ip6.arpa {
        pods insecure
        fallthrough in-addr.arpa ip6.arpa
        ttl 30
    }

    prometheus :9153

    forward . /etc/resolv.conf

    cache 30

    loop

    reload

    loadbalance
}
```

At first glance, this looks intimidating.

It isn't.

Once you understand one simple idea, everything else falls into place.

---

# CoreDNS Is Just a Pipeline

Unlike many DNS servers, CoreDNS isn't a giant application with hundreds of hardcoded features.

Instead, it's built around **plugins**.

Think of it like a factory assembly line.

```text
Incoming DNS Request

        │

        ▼

 errors

        │

        ▼

 health

        │

        ▼

 ready

        │

        ▼

 kubernetes

        │

        ▼

 cache

        │

        ▼

 forward

        │

        ▼

 loadbalance

        │

        ▼

DNS Response
```

Each plugin has one job.

A DNS request enters at the top.

Each plugin gets a chance to inspect or process it.

If a plugin can answer the request, it returns a response.

If not, it passes the request to the next plugin in the chain.

This design is one of the reasons CoreDNS is so popular—not just in Kubernetes, but as a general-purpose DNS server.

You only enable the features you actually need.

---

# `.:53`

Let's start with the very first line.

```text
.:53
```

This means:

> Listen on **port 53** for **all DNS zones**.

The dot (`.`) represents the root DNS zone.

In other words, CoreDNS is saying:

> "I'll accept DNS requests for anything."

The `53` is the standard DNS port.

Every Pod in your cluster ultimately sends DNS queries to this port.

---

# The `errors` Plugin

The first plugin is:

```text
errors
```

This plugin is simple.

Whenever CoreDNS encounters an error while processing a DNS request, it logs the error.

For example:

* malformed DNS packets
* plugin failures
* upstream lookup failures

Without this plugin, troubleshooting DNS issues would be much harder because many failures would remain invisible.

It doesn't answer queries.

It simply records problems.

---

# The `health` Plugin

Next comes:

```text
health {
    lameduck 5s
}
```

This plugin exposes a small HTTP endpoint used by Kubernetes to check whether CoreDNS is healthy.

By default, it listens on port **8080**.

You can even test it from inside the Pod.

```bash
curl localhost:8080/health
```

A healthy server responds:

```text
OK
```

---

## What Is `lameduck`?

This is one of those settings that many engineers overlook.

Imagine you're upgrading CoreDNS.

Kubernetes wants to terminate one Pod and start a new one.

If the old Pod disappeared immediately, it could still have DNS requests in flight.

Those requests would fail.

Instead, CoreDNS enters a short **lameduck period**.

```text
Pod receives termination signal

        │

Still reports healthy

        │

Finishes active requests

        │

Stops accepting new traffic

        │

Terminates
```

That five-second window allows existing DNS requests to finish gracefully.

Users never notice.

---

# The `ready` Plugin

Next:

```text
ready
```

This plugin exposes another HTTP endpoint.

Unlike `health`, which answers:

> "Is CoreDNS alive?"

`ready` answers:

> "Is CoreDNS actually ready to serve DNS?"

Those are different questions.

Imagine CoreDNS has just started.

The process is running.

But it hasn't yet synchronized with the Kubernetes API.

If Kubernetes immediately started sending traffic to it, many DNS queries would fail because CoreDNS hasn't finished loading Services and EndpointSlices.

The `ready` endpoint prevents that.

Only after every required plugin reports itself ready will Kubernetes begin routing traffic to that Pod.

---

# The Star of the Show: The `kubernetes` Plugin

Now we arrive at the heart of Kubernetes DNS.

```text
kubernetes cluster.local in-addr.arpa ip6.arpa {
    pods insecure
    fallthrough in-addr.arpa ip6.arpa
    ttl 30
}
```

Everything we've discussed in this series eventually leads here.

This plugin is responsible for answering Kubernetes-specific DNS queries.

Without it, CoreDNS would have absolutely no idea what:

```text
backend.backend
```

means.

Let's break this configuration apart.

---

# `cluster.local`

```text
kubernetes cluster.local
```

Remember this from the previous article?

```text
backend.backend.svc.cluster.local
```

The plugin is responsible for managing every DNS name under the `cluster.local` domain.

Whenever a request ends with:

```text
cluster.local
```

this plugin takes over.

For example:

```text
frontend.frontend.svc.cluster.local
```

```text
postgres.database.svc.cluster.local
```

```text
kubernetes.default.svc.cluster.local
```

All of these are handled here.

---

# `in-addr.arpa`

The next entry looks strange.

```text
in-addr.arpa
```

This is used for **reverse IPv4 DNS lookups**.

Normally we ask:

```text
backend.backend

↓

10.96.18.72
```

A reverse lookup asks the opposite question.

```text
10.96.18.72

↓

backend.backend.svc.cluster.local
```

These lookups are useful for:

* debugging
* monitoring
* logging
* network analysis

---

# `ip6.arpa`

Exactly the same concept.

Except this handles IPv6 reverse lookups.

If your cluster supports IPv6, CoreDNS uses this zone for reverse DNS.

---

# `pods insecure`

Now we reach one of the most misunderstood options.

```text
pods insecure
```

Years ago, Kubernetes allowed Pods to receive DNS records directly.

For example:

```text
10-244-2-7.default.pod.cluster.local
```

could resolve directly to a Pod.

The `pods` option controls how those Pod lookups behave.

`insecure` means CoreDNS doesn't verify whether the requesting client is actually allowed to resolve arbitrary Pod names.

In modern clusters, applications almost always communicate through Services instead of directly addressing Pods.

Because of that, many administrators never notice this option.

Some environments disable Pod DNS lookups entirely.

Others choose stricter validation modes.

---

# `ttl 30`

Finally:

```text
ttl 30
```

This controls the **Time To Live** for DNS records generated by the Kubernetes plugin.

When CoreDNS answers:

```text
backend.backend

↓

10.96.18.72
```

it tells the client:

> "You may cache this answer for 30 seconds."

Why cache it?

Because DNS lookups aren't free.

If an application repeatedly resolves the same Service name, caching dramatically reduces the number of DNS requests hitting CoreDNS.

Thirty seconds is a reasonable compromise.

* Long enough to reduce DNS traffic.
* Short enough that changes in the cluster propagate quickly.

---

# Wait... Where Are Services Stored?

We've now seen the plugin that answers Kubernetes DNS requests.

But one huge question remains.

When this plugin receives:

```text
backend.backend
```

where does it actually look?

Surely it doesn't contain thousands of hardcoded DNS records.

And surely it isn't asking the Kubernetes API Server for every request.

The answer is one of the cleverest optimizations in Kubernetes.

The plugin maintains an **in-memory cache** that is continuously updated using **informers** and **watch events** from the Kubernetes API Server.

That architecture is what allows CoreDNS to answer DNS requests in microseconds while still keeping up with a constantly changing cluster.

In the next part, we'll open that black box completely. We'll follow a Service from the moment it's created, watch the API Server notify CoreDNS, understand informers and watches, and see why CoreDNS almost never needs to query the API Server during normal DNS resolution.

# Inside CoreDNS: How Kubernetes Answers Millions of DNS Queries (Part 3)

## Informers, Watches, Caching, and the Magic Behind Fast DNS

At this point, we understand what the CoreDNS configuration looks like.

We know the `kubernetes` plugin is responsible for answering questions like:

```text id="jv92lb"
backend.backend.svc.cluster.local
```

But we still haven't answered the biggest question in this entire article.

> **Where does the Kubernetes plugin get its information?**

Imagine a cluster with:

* 15,000 Pods
* 2,500 Services
* hundreds of namespaces
* thousands of EndpointSlices

CoreDNS somehow knows about every single one.

Even more impressive, it knows almost instantly when something changes.

Create a new Service.

Delete a Deployment.

Scale a ReplicaSet.

Within seconds, DNS is already returning the new information.

How?

Let's look inside.

---

# The Naive Approach

Imagine we were building CoreDNS ourselves.

The simplest solution might be:

```text id="mptjra"
DNS Query

        │

        ▼

Ask Kubernetes API Server

        │

        ▼

Receive Service

        │

        ▼

Return DNS Answer
```

For every DNS query, we'd simply ask the Kubernetes API Server:

> "Hey, can you tell me about `backend.backend`?"

The API Server would reply with the Service.

Simple.

Unfortunately...

This would be a terrible design.

Imagine 5,000 Pods making DNS requests every second.

CoreDNS would bombard the API Server with an enormous number of requests.

The API Server would spend more time answering DNS questions than doing its actual job.

Fortunately, Kubernetes solved this problem years ago.

---

# Watches Instead of Polling

One of the smartest ideas in Kubernetes is the **Watch API**.

Instead of repeatedly asking:

```text id="42ljl4"
Has anything changed?

Has anything changed?

Has anything changed?
```

CoreDNS tells the API Server:

> **"Notify me whenever something changes."**

That's it.

One long-lived connection.

Whenever something happens, the API Server pushes an event.

Think of it like subscribing to notifications on your phone.

Instead of opening the app every five seconds to check for new messages, your phone receives a notification only when something actually changes.

CoreDNS works the same way.

---

# A Real Example

Suppose someone creates a new Service.

```bash id="gztjlwm"
kubectl expose deployment payment-api \
    --port=80
```

The sequence looks like this.

```text id="zjlwm4"
kubectl

      │

      ▼

API Server

      │

Stores Service

      │

      ▼

Watch Event

      │

      ▼

CoreDNS
```

Notice something important.

CoreDNS didn't ask.

The API Server volunteered the information.

This is called an **event-driven architecture**, and it's one of the reasons Kubernetes scales so well.

---

# Informers: More Than Just Watching

Watching is only part of the story.

If CoreDNS only listened for future events, what would happen when it first started?

It wouldn't know about any existing Services.

It would only learn about Services created after it started.

That wouldn't work.

Instead, CoreDNS uses something called an **Informer**.

An Informer does two things.

## Step 1 — Initial List

When CoreDNS starts, it asks the API Server:

> "Give me every Service."

```text id="6vknxg"
API Server

Services

frontend

backend

postgres

redis

payments

monitoring
```

CoreDNS downloads everything.

---

## Step 2 — Start Watching

Immediately afterward,

it switches to watch mode.

```text id="g6tyby"
Initial List

        │

        ▼

Watch

        │

        ▼

Receive Updates Forever
```

This combination is incredibly powerful.

CoreDNS gets the complete picture of the cluster,

then only receives changes.

It never has to repeatedly fetch everything again.

---

# The Local Cache

After downloading the objects,

CoreDNS stores them in memory.

Imagine something like this.

```text id="8m6cxu"
CoreDNS

Memory

────────────────────────

Services

backend

frontend

postgres

redis

────────────────────────

Namespaces

backend

frontend

database

────────────────────────

EndpointSlices

backend

↓

10.244.1.8

10.244.2.14

10.244.3.6
```

This cache lives entirely in RAM.

That means when a DNS request arrives,

CoreDNS doesn't need to contact the API Server.

Instead,

it simply performs an in-memory lookup.

Those are incredibly fast.

Usually measured in microseconds.

---

# Following a Real DNS Query

Let's replay our request.

```text id="jp98y8"
backend.backend
```

The Kubernetes plugin receives it.

The plugin asks its cache:

```text id="kw5k9m"
Do I know a Service named

backend

inside

backend namespace?
```

The cache responds immediately.

```text id="g54tey"
Yes.

ClusterIP

10.96.18.72
```

CoreDNS constructs a DNS response and sends it back to the frontend Pod.

No network calls.

No database.

No API request.

Just memory.

---

# What About EndpointSlices?

Remember from the previous article:

Services don't actually store Pod IP addresses.

EndpointSlices do.

CoreDNS watches those too.

Imagine we scale our backend Deployment.

```bash id="g3qx3u"
kubectl scale deployment backend \
--replicas=5
```

Behind the scenes,

this happens.

```text id="t0xfzp"
Deployment

        │

Creates Pods

        │

        ▼

EndpointSlice Updated

        │

        ▼

Watch Event

        │

        ▼

CoreDNS Cache Updated
```

Again,

CoreDNS didn't poll.

It simply received the update.

---

# What If CoreDNS Misses an Event?

Suppose the network briefly disconnects.

Would CoreDNS become permanently out of sync?

Thankfully, no.

Every object in Kubernetes has something called a **resource version**.

Whenever the watch connection is interrupted,

the Informer reconnects and asks:

> "Continue from resource version X."

If that version is too old,

the Informer simply performs another full list operation,

refreshes the cache,

and starts watching again.

This makes the system extremely resilient.

---

# Why Not Store Everything in etcd Directly?

Another common question is:

> "If the API Server stores everything in etcd, why doesn't CoreDNS just read etcd?"

Because the API Server is the only supported interface for Kubernetes resources.

It provides:

* authentication
* authorization
* admission control
* validation
* version conversion
* watches
* consistent APIs

Reading etcd directly would bypass all of those guarantees.

That's why almost every Kubernetes component—including CoreDNS, controllers, operators, and schedulers—communicates with the API Server instead of etcd.

---

# So What Happens When You Create a New Service?

Let's follow the complete sequence.

```bash id="1ml9a5"
kubectl apply -f payment-service.yaml
```

↓

```text id="w1syvh"
kubectl

        │

        ▼

API Server

        │

Stores Service

        │

Writes to etcd

        │

Sends Watch Event

        │

        ▼

CoreDNS Informer

        │

Updates Memory Cache

        │

        ▼

DNS Query Arrives

        │

Cache Lookup

        │

        ▼

DNS Response Returned
```

Notice something remarkable.

The Kubernetes API Server is involved only **once**—when the Service changes.

It isn't involved in every DNS query.

That's one of the reasons Kubernetes can scale to such large clusters.

---

# What About External Websites?

So far, every query we've looked at has ended with:

```text id="8kjxnh"
cluster.local
```

Those are Kubernetes Services.

But what happens when a Pod runs:

```bash id="h8stzm"
curl https://google.com
```

or

```bash id="r0xg3v"
curl https://amazon.com
```

Those names obviously don't exist inside the Kubernetes API.

CoreDNS has no Service called:

```text id="k6hxva"
google.com
```

So how are those requests resolved?

That's where another important plugin enters the picture:

```text id="dxx37b"
forward
```

Instead of answering the query itself, CoreDNS forwards the request to an upstream DNS server—usually the same DNS servers configured on the node running the CoreDNS Pod.

Combined with the `cache` and `loadbalance` plugins, this allows CoreDNS to resolve both **internal Kubernetes Services** and **external internet domains** using a single DNS endpoint.

We'll explore those plugins in the final part of this article, along with DNS caching, custom forwarding, stub domains, DNS policies, and practical troubleshooting techniques you'll use when DNS doesn't behave the way you expect.

# Inside CoreDNS: How Kubernetes Answers Millions of DNS Queries (Part 4)

## Forwarding, Caching, Custom DNS, and Debugging Like a Pro

We've spent most of this article looking at how CoreDNS resolves **internal Kubernetes Services**.

When we queried:

```bash
curl http://backend.backend
```

CoreDNS answered the request itself because it knew about the Service from its in-memory cache.

But what happens when a Pod wants to access something that **doesn't exist inside Kubernetes**?

For example:

```bash
curl https://google.com
```

or

```bash
curl https://api.github.com
```

CoreDNS has never seen a Service called `google.com`.

There isn't a Kubernetes object named `api.github.com`.

So how does your Pod still reach the internet?

The answer lies in one of CoreDNS's most important plugins.

---

# The `forward` Plugin

Let's look at our ConfigMap again.

```text
forward . /etc/resolv.conf
```

This single line is responsible for every external DNS lookup in your cluster.

Let's break it apart.

```text
forward
```

means:

> "If I can't answer this DNS query myself, send it to another DNS server."

The dot (`.`) means:

> "Apply this rule to every DNS zone."

Finally,

```text
/etc/resolv.conf
```

tells CoreDNS where those upstream DNS servers are.

Wait...

Didn't we already look at `/etc/resolv.conf` in the previous article?

Yes.

But that was the `resolv.conf` inside **our frontend Pod**.

This one is different.

It's the `resolv.conf` inside the **CoreDNS Pod**.

Let's inspect it.

```bash
kubectl exec \
-n kube-system \
deploy/coredns \
-- cat /etc/resolv.conf
```

Example:

```text
nameserver 192.168.1.1
```

or perhaps:

```text
nameserver 8.8.8.8
nameserver 1.1.1.1
```

These are simply the DNS servers configured on the Kubernetes node.

So when CoreDNS doesn't know the answer, it asks someone else.

The flow looks like this.

```text
Frontend Pod

       │

google.com

       │

       ▼

CoreDNS

       │

Doesn't know

       │

       ▼

Forward Plugin

       │

       ▼

Node DNS Server

       │

       ▼

Internet DNS

       │

       ▼

Returns Google's IP
```

To your application, everything still appears to come from CoreDNS.

---

# The `cache` Plugin

Let's revisit another plugin.

```text
cache 30
```

Imagine a thousand Pods all requesting:

```text
google.com
```

Without caching,

CoreDNS would forward every request to an upstream DNS server.

That would be wasteful.

Instead,

the first lookup is forwarded.

The answer is stored in memory.

Every subsequent request receives the cached result.

```text
Pod A

google.com

        │

        ▼

CoreDNS

        │

Cache Miss

        ▼

Upstream DNS

        │

Stores Result

──────────────────────────

Pod B

google.com

        │

        ▼

CoreDNS

        │

Cache Hit

        ▼

Immediate Response
```

This dramatically reduces DNS traffic and speeds up name resolution across the cluster.

---

# The `loadbalance` Plugin

Suppose a Service has several backend Pods.

```text
backend

↓

10.244.1.5

10.244.2.8

10.244.3.12
```

DNS responses can contain multiple addresses.

Without any balancing,

clients might always receive the addresses in the same order.

Some clients always connect to the first IP returned.

That could unintentionally overload one Pod.

The `loadbalance` plugin randomizes the order of returned records.

For example,

Request 1:

```text
10.244.2.8

10.244.1.5

10.244.3.12
```

Request 2:

```text
10.244.3.12

10.244.2.8

10.244.1.5
```

It doesn't replace Kubernetes load balancing, but it helps distribute client behavior more evenly.

---

# The `reload` Plugin

Configuration changes shouldn't require deleting Pods.

The `reload` plugin watches the CoreDNS configuration.

Whenever the ConfigMap changes,

CoreDNS automatically reloads itself.

Without this plugin,

you would need to restart every CoreDNS Pod after every configuration change.

---

# The `loop` Plugin

This is one of the smallest plugins,

but it prevents one of the most dangerous DNS problems.

Imagine this configuration.

```text
CoreDNS

↓

Forward

↓

Node DNS

↓

CoreDNS

↓

Forward

↓

Node DNS

↓

CoreDNS
```

The query would bounce forever.

Eventually,

every DNS lookup would consume CPU until the server collapsed.

The `loop` plugin detects these forwarding loops during startup.

If it finds one,

CoreDNS refuses to continue.

---

# Can We Customize Kubernetes DNS?

Absolutely.

CoreDNS isn't limited to Kubernetes Services.

You can configure it to resolve your own internal domains.

Imagine your company owns:

```text
company.internal
```

Instead of forwarding requests to your node's DNS server,

you could forward them to your organization's DNS infrastructure.

For example:

```text
company.internal {

    forward . 10.20.30.40

}
```

Now every Pod can resolve company resources without any application changes.

This feature is often called a **stub domain**.

It allows Kubernetes to integrate seamlessly with existing enterprise networks.

---

# DNS Policies

Earlier in the series,

we saw that every Pod receives a generated `/etc/resolv.conf`.

But not every Pod needs Kubernetes DNS.

Kubernetes allows you to choose how DNS should behave using `dnsPolicy`.

The default is:

```yaml
dnsPolicy: ClusterFirst
```

This means:

> Try Kubernetes DNS first.

This is what almost every application uses.

---

Another option is:

```yaml
dnsPolicy: Default
```

Here,

the Pod inherits the node's DNS configuration instead of using Kubernetes DNS.

This is uncommon,

but occasionally useful for special workloads.

---

You can also completely customize DNS.

```yaml
dnsPolicy: None

dnsConfig:
  nameservers:
  - 1.1.1.1
```

Now Kubernetes won't generate DNS settings at all.

Instead,

the Pod uses exactly the nameservers you specify.

Finally,

there's:

```yaml
dnsPolicy: ClusterFirstWithHostNet
```

This is designed for Pods using:

```yaml
hostNetwork: true
```

Without it,

those Pods would accidentally inherit the node's DNS configuration instead of Kubernetes DNS.

---

# Common DNS Problems

Whenever DNS breaks,

don't immediately restart Pods.

Instead,

walk through the request exactly as we did in this series.

### Step 1

Check the Pod's DNS configuration.

```bash
kubectl exec deploy/frontend \
-n frontend \
-- cat /etc/resolv.conf
```

---

### Step 2

Verify CoreDNS is healthy.

```bash
kubectl get pods -n kube-system
```

---

### Step 3

Inspect the logs.

```bash
kubectl logs \
-n kube-system \
deploy/coredns
```

---

### Step 4

Test DNS directly.

```bash
kubectl exec \
-it deploy/frontend \
-n frontend \
-- nslookup backend.backend
```

Try an external domain too.

```bash
nslookup google.com
```

If internal lookups work but external ones fail,

the issue is probably with upstream forwarding.

If neither works,

CoreDNS itself may be unavailable.

---

### Step 5

Inspect the configuration.

```bash
kubectl edit configmap coredns \
-n kube-system
```

Make one small change.

Save it.

Watch the Pods.

Notice they don't restart.

The `reload` plugin quietly applies the new configuration.

---

# Breaking CoreDNS (Safely)

One of the best ways to understand a system is to break it.

Try changing the cluster domain in the ConfigMap.

Immediately,

applications trying to resolve:

```text
backend.backend.svc.cluster.local
```

will begin failing because CoreDNS is now expecting a different DNS suffix.

Restore the configuration,

and resolution immediately begins working again.

Or,

temporarily remove the `forward` plugin.

Internal Services will still resolve.

But this won't.

```bash
curl https://google.com
```

Why?

Because CoreDNS no longer knows how to ask an upstream DNS server.

These experiments make it much easier to understand which plugin is responsible for each part of the DNS process.

---

# Putting Everything Together

Let's replay one final DNS query.

```text
Application

        │

backend.backend

        │

        ▼

Linux Resolver

        │

        ▼

kube-dns Service

        │

        ▼

CoreDNS

        │

Kubernetes Plugin

        │

Looks in Memory Cache

        │

Returns ClusterIP

        │

        ▼

Application connects
```

Now let's try an external website.

```text
Application

        │

google.com

        │

        ▼

Linux Resolver

        │

        ▼

kube-dns Service

        │

        ▼

CoreDNS

        │

Kubernetes Plugin

        │

Doesn't know

        │

        ▼

Forward Plugin

        │

        ▼

Upstream DNS

        │

        ▼

Returns Internet IP
```

The same DNS server answers both requests.

One from Kubernetes.

One from the public internet.

Your application doesn't know the difference.

And that's exactly the point.

---

# Key Takeaways

Before this article, CoreDNS may have seemed like another Pod running in the `kube-system` namespace.

Now you know it's much more than that.

* Every Pod sends DNS queries to the **`kube-dns` Service**, not directly to CoreDNS.
* CoreDNS doesn't repeatedly query the Kubernetes API Server. Instead, it uses **informers** and **watch events** to maintain an in-memory cache of Services, Namespaces, and EndpointSlices.
* The **`kubernetes` plugin** answers queries for cluster resources such as `backend.backend.svc.cluster.local`.
* The **`forward` plugin** resolves domains outside the cluster by sending requests to upstream DNS servers.
* Plugins like **`cache`**, **`reload`**, **`loop`**, **`health`**, and **`ready`** each solve a specific operational problem and work together as a processing pipeline.

Understanding these pieces transforms DNS from a black box into a system you can reason about, debug, and even customize.

---

# What's Next?

We've now answered the question:

> **How does Kubernetes translate a Service name into a ClusterIP?**

But another mystery remains.

CoreDNS returned the address:

```text
10.96.18.72
```

That isn't a Pod.

It isn't a container.

It isn't attached to any network interface.

So why does sending packets to that IP still work?

In the next article, we'll follow those packets into one of Kubernetes' most misunderstood components: **kube-proxy**.

We'll discover how a virtual IP becomes a real destination, compare **iptables**, **IPVS**, and **nftables**, inspect the actual rules Kubernetes installs on every node, and trace packets all the way from a Service IP to the backend Pod that ultimately handles the request. -->
