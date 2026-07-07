---
title: "Building a Kubernetes CNI From Scratch (Part 2): Linux Namespaces, cgroups and the Building Blocks of Container Networking"
description: "Before writing a CNI plugin, we need to understand the Linux primitives that make container networking possible. In this article, we explore Linux namespaces, cgroups, the pause container, and how Kubernetes isolates networking under the hood."
date: "2026-07-06"
tags: "Kubernetes, Linux, Networking, CNI, Containerd, Platform Engineering, Cloud Native"
published: true
---

In the previous article, we discovered why a freshly installed Kubernetes cluster refuses to become **Ready** without a Container Network Interface (CNI).

We followed the journey of a Pod from the API Server all the way to the container runtime, where the runtime eventually invoked a CNI plugin to configure networking.

But we stopped right before the interesting part.

The obvious question now becomes:

> **How does a CNI actually provide networking to a Pod?**

Does it create a virtual machine?

Does it create a Docker bridge?

Does it assign an IP address directly?

Does Kubernetes somehow invent networking on its own?

The answer is much simpler.

A CNI doesn't invent anything.

It simply orchestrates networking primitives that have existed in the Linux kernel for years.

Once you understand those primitives, reading the source code of projects like Cilium, Calico, Flannel or your own CNI implementation becomes significantly easier because you'll realize they're mostly automating the same sequence of Linux operations.

In this article, we'll leave Kubernetes aside for a while and explore the Linux features that make containers possible.

We'll answer questions like:

- What exactly is a Linux namespace?
- Why is a network namespace different from a Kubernetes namespace?
- What are cgroups?
- Why does every Pod have a pause container?
- How do multiple containers inside the same Pod share one network stack?

By the end of this article, you'll understand the environment in which our CNI will eventually operate.

In Part 3, we'll build the actual networking manually using bridges, virtual Ethernet (veth) pairs and routing tables before finally automating everything inside our own CNI plugin.

## **Containers Are Just Linux**

One of the biggest misconceptions about containers is that they're some revolutionary operating system technology invented by Docker or Kubernetes.

They're not.

Containers are simply ordinary Linux processes that happen to be isolated from one another.

Linux already provided most of the technologies required years before Docker became popular.

Docker simply combined those technologies into an easy-to-use developer experience.

Kubernetes builds on exactly the same concepts.

Some of the Linux features containers rely on include:

- Namespaces
- cgroups
- Capabilities
- Overlay filesystems
- Virtual Ethernet (veth) devices
- Linux bridges
- iptables/nftables

In this article, we'll focus on the first two because every CNI plugin depends heavily on them.

## **What Is a Linux Namespace?**

Imagine you're sitting inside a large office building.

Everyone shares the same electricity.

Everyone shares the same internet connection.

Everyone shares the same building.

But each team has its own office.

People inside one office don't automatically know what's happening in another office.

That's essentially what Linux namespaces provide.

A namespace creates an isolated view of a particular operating system resource.

Processes inside one namespace believe they're the only ones using that resource, even though the Linux kernel is actually sharing the underlying hardware with many other processes.

Linux provides several namespace types.

| Namespace | Isolates |
|-----------|----------|
| PID | Process IDs |
| Network | Network interfaces, routes and firewall rules |
| Mount | Filesystem mount points |
| UTS | Hostname and domain name |
| IPC | Inter-process communication |
| User | User and group IDs |
| cgroup | cgroup hierarchy (on some systems) |

A container usually lives inside several namespaces simultaneously.

For example, it has:

- its own process tree
- its own hostname
- its own filesystem view
- its own network interfaces

All while sharing the same Linux kernel as every other container on the machine.

This lightweight isolation is one of the main reasons containers start much faster than virtual machines.

## **Kubernetes Namespaces vs Linux Namespaces**

The word **namespace** unfortunately means two completely different things depending on the context.

A **Kubernetes Namespace** is simply a logical grouping of Kubernetes resources.

For example:

```
production/

development/

monitoring/
```

Pods inside different Kubernetes namespaces can still communicate with one another unless NetworkPolicies say otherwise.

A Kubernetes namespace is therefore an organizational concept.

A **Linux Network Namespace**, on the other hand, is an operating system feature.

It provides complete network isolation.

Each network namespace owns its own:

- Network interfaces
- Routing table
- ARP table
- Loopback interface
- Firewall rules
- Socket table

Two Linux network namespaces cannot communicate unless we explicitly connect them.

This distinction is incredibly important because Kubernetes uses Linux network namespaces behind every Pod.

Whenever Kubernetes documentation mentions that "each Pod gets its own IP address," what it really means is:

> Each Pod gets its own Linux network namespace.

Everything else follows from that.

## **Creating Our First Network Namespace**

Let's create one ourselves.

First, list the network namespaces that currently exist.

```bash
ip netns list
```

On most fresh Linux installations, you'll probably see nothing.

Now let's create our own namespace.

```bash
sudo ip netns add pod1
```

Think of this as creating an entirely new virtual machine's networking stack—except without creating another operating system.

Verify it exists.

```bash
ip netns list
```

Example output:

```
pod1
```

Congratulations.

You've just created an isolated network stack.

But what actually exists inside it?

Let's inspect the interfaces.

```bash
sudo ip netns exec pod1 ip addr
```

You'll probably see something similar to:

```
1: lo: <LOOPBACK>
```

That's it.

Only the loopback interface exists.

No Ethernet interface.

No IP address.

No default gateway.

No route to the Internet.

This namespace is completely isolated from the rest of the machine.

In the next section, we'll enter the namespace, explore its routing table, and begin understanding why a newly created network namespace cannot communicate with anything—not even the host machine.

### **Entering the Network Namespace**

Creating a network namespace is only half the story.

The next step is to actually enter it.

Linux provides the `ip netns exec` command, which temporarily executes another command inside a specific network namespace.

For example:

```bash
sudo ip netns exec pod1 bash
```

You'll now find yourself inside a new shell.

Although it still looks like your normal Ubuntu machine, the networking you're seeing is completely different.

Let's verify that.

Check the available network interfaces.

```bash
ip link
```

You'll see something similar to:

```
1: lo: <LOOPBACK>
```

Only the loopback interface exists.

Now inspect the IP addresses.

```bash
ip addr
```

Again, you'll only see the loopback interface.

Finally, inspect the routing table.

```bash
ip route
```

Nothing.

No default gateway.

No routes.

No Ethernet interface.

No Internet.

This namespace is completely isolated.

If you try to ping Google,

```bash
ping 8.8.8.8
```

you'll immediately notice that it fails.

Not because Google is down, but because this namespace literally has no idea where packets should go.

Later in this series, our CNI will solve exactly this problem.

It will create interfaces, assign IP addresses, configure routes and connect this namespace to the outside world.

For now, it's just an empty network stack waiting to be configured.

Exit the namespace when you're done.

```bash
exit
```

### **Looking at the Host Network Namespace**

Something interesting to realize is that your Linux host is also inside a network namespace.

It's simply the **default** network namespace.

Whenever you execute commands like:

```bash
ip addr

ip route

ip link
```

without specifying a namespace, you're inspecting the host's networking.

For example:

```bash
ip addr
```

might return something similar to:

```
lo

eth0
```

or perhaps

```
ens18

docker0

cni0
```

depending on what software is installed.

Unlike our newly created namespace, the host already has:

- Physical network interfaces
- Routing information
- Internet connectivity
- Existing firewall rules

The namespace we created earlier has none of those.

This isolation is exactly what containers rely upon.

## **Every Pod Gets Its Own Network Namespace**

Earlier we learned that Kubernetes creates something called the **Pod Sandbox** before launching your application container.

Now we can finally explain why.

Every Pod receives its own Linux network namespace.

That namespace becomes the Pod's networking environment.

Everything inside the Pod shares it.

Suppose we deploy:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: demo
spec:
  containers:
  - name: nginx
    image: nginx

  - name: sidecar
    image: busybox
```

Most beginners assume Kubernetes creates two independent containers with two IP addresses.

It doesn't.

Instead, Kubernetes creates one network namespace.

Both containers join it.

Conceptually it looks like this.

```
                Pod

        +----------------------+
        |                      |
        |  Network Namespace   |
        |                      |
        |    eth0              |
        |    lo                |
        |                      |
        | nginx     busybox    |
        +----------------------+
```

Notice something important.

There is only **one** networking stack.

Not one per container.

Both containers share:

- the same IP address
- the same network interfaces
- the same routing table
- the same localhost interface

This explains one of Kubernetes' most interesting behaviors.

If nginx listens on:

```
localhost:80
```

the BusyBox container can also access:

```
localhost:80
```

because **localhost belongs to the shared network namespace, not to an individual container.**

This is exactly why sidecar containers work.

## **Meet the Pause Container**

So who owns that network namespace?

Surprisingly, not your application container.

Before Kubernetes starts your application, the container runtime first creates a tiny container called the **Pause Container**.

Its job is almost unbelievably simple.

It sleeps forever.

That's all.

It doesn't serve traffic.

It doesn't process requests.

It doesn't perform health checks.

Instead, it acts as the permanent owner of the Pod's Linux namespaces.

Your application containers simply join those namespaces.

Conceptually:

```
Pause Container
      │
      │ owns
      ▼
Network Namespace
      ▲
      │
 ┌──────────────┐
 │ nginx        │
 │ redis        │
 │ sidecar      │
 └──────────────┘
```

If the pause container disappeared, the namespace would disappear with it.

That's why Kubernetes creates it before every other container.

## **Inspecting the Pause Container Using containerd**

Since we're using **containerd** throughout this series, let's inspect what Kubernetes actually created.

First, list all Pods known to the runtime.

```bash
sudo crictl pods
```

You'll see something similar to:

```
POD ID              CREATED      STATE      NAME
7b7d...             Ready        nginx
```

Now list the containers.

```bash
sudo crictl ps
```

Example:

```
CONTAINER ID      IMAGE         NAME

9c4d...           nginx         nginx

5aa8...           pause         POD
```

Notice something interesting.

There are two containers.

Not one.

One is your nginx container.

The other is the pause container.

Let's inspect the Pod Sandbox.

```bash
sudo crictl inspectp <POD_ID>
```

Scroll through the JSON output.

Eventually you'll find something similar to:

```json
{
  "linux": {
      "namespaces": {
          "options": {}
      }
}
}
```

The runtime also stores the path to the Pod's network namespace.

Although the exact JSON structure varies slightly between CRI implementations, you'll find a namespace path similar to:

```
/var/run/netns/...
```

or

```
/proc/.../ns/net
```

That path uniquely identifies the Linux network namespace belonging to the Pod.

Both the pause container and every application container inside the Pod reference that same namespace.

## **Proving Containers Share the Same Network Namespace**

Let's prove it.

Suppose we deploy a Pod containing two containers.

One container runs nginx.

The other runs BusyBox.

Once the Pod is running, execute a shell inside the BusyBox container.

```bash
kubectl exec -it demo -c busybox -- sh
```

Now try accessing nginx.

```bash
wget -qO- http://localhost
```

or

```bash
wget -qO- http://127.0.0.1
```

Instead of failing, you'll receive the nginx default page.

How is that possible?

The BusyBox container isn't running a web server.

The answer is simple.

Both containers share exactly the same Linux network namespace.

When BusyBox connects to `localhost`, it's talking to the Pod's shared networking stack, where nginx is already listening on port 80.

This small experiment demonstrates one of the core ideas behind Kubernetes Pods.

A Pod is **not** just a collection of containers.

It's a collection of containers that intentionally share Linux resources—most importantly, a single network namespace.

## **What Are cgroups?**

So far we've learned how Linux isolates processes using namespaces.

Namespaces answer the question:

> **What can this process see?**

A process inside its own network namespace only sees its own interfaces.

A process inside its own PID namespace only sees its own processes.

But isolation alone isn't enough.

Imagine you have two Pods running on the same node.

One Pod accidentally starts consuming all available memory.

Or perhaps it starts an infinite loop and uses 100% of the CPU.

Without another mechanism, one badly behaved application could slow down—or even crash—the entire node.

This is where **cgroups** come in.

A **control group**, or **cgroup**, is another Linux kernel feature that controls how much of a system's resources a process or group of processes may consume.

Where namespaces provide **isolation**, cgroups provide **resource management**.

Think of them as complementary technologies.

Namespaces say:

> "This process can only see its own networking."

cgroups say:

> "This process may only use 500MiB of memory and half a CPU."

Together, they form the foundation of every container runtime.

## **What Resources Can cgroups Control?**

Modern Linux cgroups can manage almost every important system resource.

Some of the most common include:

| Resource | What It Controls |
|----------|------------------|
| CPU | Maximum CPU usage |
| Memory | RAM usage |
| PIDs | Maximum number of processes |
| Block I/O | Disk throughput |
| Network Priority | Relative network priority |
| Huge Pages | Huge page allocation |

Whenever you write something like:

```yaml
resources:
  requests:
    cpu: "250m"
    memory: "128Mi"

  limits:
    cpu: "500m"
    memory: "512Mi"
```

inside a Pod specification, Kubernetes is not enforcing those limits itself.

Instead, kubelet passes those values to the container runtime.

The runtime then configures Linux cgroups for the container.

In other words, Kubernetes delegates resource enforcement to the Linux kernel.

## **Inspecting cgroups on Your Machine**

Let's see cgroups in action.

One useful command is:

```bash
systemd-cgls
```

This displays the cgroup hierarchy currently managed by systemd.

The output looks something like:

```
Control group /

├── system.slice

├── user.slice

├── kubepods.slice

└── init.scope
```

If your node is running Kubernetes, you'll usually notice something interesting.

```
kubepods.slice
```

Inside that hierarchy are cgroups created for every running Pod.

Kubernetes isn't doing anything magical.

It's simply asking Linux to create resource boundaries for each Pod.

Another useful command is:

```bash
cat /proc/self/cgroup
```

This prints the cgroup to which the current process belongs.

Example:

```
0::/user.slice/user-1000.slice/session-2.scope
```

Every running process belongs to exactly one cgroup hierarchy.

To watch resource consumption live, try:

```bash
systemd-cgtop
```

This is similar to `top`, except instead of showing individual processes, it displays CPU and memory usage grouped by cgroups.

If Kubernetes is running on the machine, you'll even see Pods consuming resources in real time.

It's an excellent way to visualize how Kubernetes relies on Linux underneath.

## **Namespaces and cgroups Work Together**

At this point we have the two most important building blocks behind every container.

Namespaces provide isolation.

cgroups provide resource control.

Neither replaces the other.

Instead, they work together.

Imagine Kubernetes starts an nginx Pod.

Conceptually, Linux creates something like this:

```
                 nginx Container

        ┌────────────────────────────┐
        │                            │
        │  Network Namespace         │
        │  PID Namespace             │
        │  Mount Namespace           │
        │  UTS Namespace             │
        │                            │
        └──────────────┬─────────────┘
                       │
                 Attached to
                       │
               Memory cgroup
               CPU cgroup
               PID cgroup
```

From the application's perspective:

- it believes it's the only machine running
- it only sees its own processes
- it only sees its own interfaces
- it has its own hostname

Meanwhile, the Linux kernel quietly ensures it never exceeds the CPU and memory limits configured by Kubernetes.

This combination is precisely what makes containers lightweight.

Unlike virtual machines, containers don't require another operating system.

They simply reuse the existing Linux kernel while giving each workload its own isolated view of the system.

## **Bringing Everything Back to Kubernetes**

Let's connect everything we've learned so far.

Back in Part 1, we stopped at the moment where the container runtime invoked the CNI plugin.

We now know a lot more about what happens before our CNI even starts executing.

The sequence looks something like this:

```
User

    │

kubectl apply

    │

API Server

    │

Scheduler

    │

Kubelet

    │

Container Runtime (containerd)

    │

Creates Pod Sandbox

    │

Creates Linux Namespaces

    │

Configures cgroups

    │

Invokes CNI Plugin

    │

CNI Creates Networking
```

Notice where our CNI fits into the picture.

The CNI **does not create the Pod.**

It **does not create cgroups.**

It **does not schedule workloads.**

Those responsibilities belong to other Kubernetes components.

Instead, the CNI receives a brand-new network namespace from the container runtime and performs one specific job:

> Connect this isolated namespace to the rest of the world.

How it does that is the subject of our next article.

## **What's Coming Next?**

We've now built the Linux foundation required to understand container networking.

You should now understand:

- What Linux namespaces are
- Why Kubernetes Pods receive their own network namespace
- Why every Pod contains a pause container
- How multiple containers inside a Pod share one networking stack
- What cgroups are
- How Kubernetes enforces CPU and memory limits using cgroups

In the next article, we'll finally start building networking ourselves.

We'll create a Linux bridge, build virtual Ethernet (veth) pairs, connect them to our network namespace, assign IP addresses, configure routing tables, and eventually give our isolated namespace access to both the host and the outside world.

By the end of Part 3, we'll have manually recreated most of what a real CNI plugin does before we automate everything in Go.
